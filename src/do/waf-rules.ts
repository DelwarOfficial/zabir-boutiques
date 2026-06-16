/**
 * WAF Custom Rules [Master_Prompt v7.0 §9.4, Phase 1.8]
 *
 * Cloudflare WAF provides managed rulesets (Cloudflare Managed, OWASP,
 * Leaked Credentials) and per-zone custom rules. We don't define the
 * managed ones in code — those are configured in the Cloudflare
 * dashboard and pinned via the API. We DO define the custom ruleset
 * so it can be re-applied in a fully reproducible way.
 *
 * The WafRules DO acts as a hot-path counter for blocked requests
 * (analytics) and as the source of truth for the active ruleset
 * version. WAF enforcement itself happens in the Cloudflare
 * perimeter (before the Worker is invoked); the DO is a
 * observability/cache layer for the custom ruleset.
 */
interface Env {
  WAF_RULES: DurableObjectNamespace;
  WAF_RULESET_VERSION?: string;
  ANALYTICS?: AnalyticsEngineDataset;
}

interface Rule {
  id: string;
  description: string;
  expression: string;
  action: "block" | "managed_challenge" | "js_challenge" | "log";
  enabled: boolean;
  zone?: string; // empty = all zones
}

const DEFAULT_RULES: Rule[] = [
  {
    id: "staff-bruteforce-1m",
    description: "Block staff login attempts > 5/min from a single IP (fail-closed supplement to middleware rate limit).",
    expression: '(http.request.uri.path eq "/api/staff/login" and rate(1m) > 5)',
    action: "managed_challenge",
    enabled: true,
  },
  {
    id: "checkout-bruteforce-1m",
    description: "Throttle /api/checkout if > 20/min from a single IP (low-rate bots).",
    expression: '(http.request.uri.path eq "/api/checkout" and rate(1m) > 20)',
    action: "js_challenge",
    enabled: true,
  },
  {
    id: "block-bad-bots",
    description: "Block obvious bad-bot UAs (caught before the Worker runs).",
    expression:
      '(http.user_agent contains "sqlmap" or http.user_agent contains "nikto" or http.user_agent contains "masscan" or http.user_agent contains "zgrab")',
    action: "block",
    enabled: true,
  },
  {
    id: "block-admin-probes",
    description: "Challenge /wp-* and /.env probes.",
    expression:
      '(http.request.uri.path matches "^/wp-.*" or http.request.uri.path eq "/.env" or http.request.uri.path eq "/phpmyadmin" or http.request.uri.path eq "/xmlrpc.php")',
    action: "managed_challenge",
    enabled: true,
  },
  {
    id: "leaked-credentials",
    description: "Cloudflare Leaked Credentials Check (managed, pin via dashboard).",
    expression: 'cf.waf.score le 30',
    action: "managed_challenge",
    enabled: true,
  },
];

export class WafRules implements DurableObject {
  private storage: DurableObjectStorage;
  private env: Env;
  private state: { rules: Rule[]; version: string; lastRotatedAt: string };

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage;
    this.env = env;
    this.state = {
      rules: DEFAULT_RULES,
      version: env.WAF_RULESET_VERSION ?? "v1",
      lastRotatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
    void state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<{ rules: Rule[]; version: string; lastRotatedAt: string }>("waf");
      if (stored) this.state = stored;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/rules") {
      return Response.json({ ok: true, ...this.state });
    }
    if (req.method === "POST" && url.pathname === "/rotated") {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const v = (await req.json().catch(() => ({}))) as { version?: string };
      this.state = { ...this.state, version: v.version ?? "v" + (Math.floor(Date.now() / 1000)), lastRotatedAt: now };
      await this.storage.put("waf", this.state);
      return Response.json({ ok: true, ...this.state });
    }
    if (req.method === "POST" && url.pathname === "/event") {
      // Lightweight analytics sink: payload is { ruleId, action, ip, path, ts }.
      const e = (await req.json().catch(() => ({}))) as { ruleId?: string; action?: string; ip?: string; path?: string; ts?: string };
      if (e.ruleId && e.action && this.env.ANALYTICS) {
        this.env.ANALYTICS.writeDataPoint({
          indexes: [e.ruleId],
          blobs: [e.action, e.path ?? ""],
          doubles: [1],
        });
      }
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }
}
