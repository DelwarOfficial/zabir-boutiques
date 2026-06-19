import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

type Severity = 'P0' | 'P1' | 'P2' | 'P3';

interface Finding {
  code: string;
  severity: Severity;
  file: string;
  line?: number;
  snippet: string;
  fix: string;
}

interface Check {
  code: string;
  severity: Severity;
  fix: string;
  run: () => Finding[];
}

function runRg(pattern: string, args: string[], cwd = resolve('.')): Finding[] {
  try {
    const raw = execFileSync('rg', [pattern, ...args, '--json', '--no-heading'], { encoding: 'utf8', cwd });
    return raw.trim().split('\n').filter(Boolean).flatMap((line) => {
      const parsed = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (parsed.type !== 'match' || !parsed.data?.path?.text) return [];
      return [{
        code: '',
        severity: 'P3' as Severity,
        file: parsed.data.path.text,
        line: parsed.data.line_number,
        snippet: parsed.data.lines?.text?.trim().slice(0, 200) ?? '',
        fix: '',
      }];
    });
  } catch {
    return [];
  }
}

function withMeta(check: Pick<Check, 'code' | 'severity' | 'fix'>, findings: Finding[]): Finding[] {
  return findings.map((finding) => ({ ...finding, code: check.code, severity: check.severity, fix: check.fix }));
}

function listFiles(root: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = [];
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (predicate(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function rel(path: string): string {
  return path.replace(`${resolve('.')}${path.startsWith(resolve('.')) ? '' : ''}`, '').replace(/^[/\\]+/, '').replaceAll('\\', '/');
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function makeFinding(code: string, severity: Severity, file: string, snippet: string, fix: string, line?: number): Finding {
  return { code, severity, file: file.replaceAll('\\', '/'), line, snippet: snippet.slice(0, 200), fix };
}

function findLine(content: string, needle: string): number | undefined {
  const idx = content.indexOf(needle);
  if (idx === -1) return undefined;
  return content.slice(0, idx).split('\n').length;
}

/** Section 3.4 static routes that must opt in with prerender = true. */
const STATIC_PRERENDER_ROUTES = [
  'src/pages/index.astro',
  'src/pages/products/[slug].astro',
  'src/pages/categories/[slug].astro',
  'src/pages/collections/[slug].astro',
  'src/pages/blog/[slug].astro',
  'src/pages/about.astro',
  'src/pages/privacy.astro',
  'src/pages/terms.astro',
  'src/pages/return-policy.astro',
  'src/pages/size-guide.astro',
  'src/pages/sitemap.xml.ts',
  'src/pages/robots.txt.ts',
];

function isStaticPrerenderRoute(normalized: string): boolean {
  if (STATIC_PRERENDER_ROUTES.includes(normalized)) return true;
  return /^src\/pages\/(products|categories|collections|blog)\/\[slug\]\.astro$/.test(normalized);
}

function prerenderRouteChecks(): Finding[] {
  const findings: Finding[] = [];
  const pageFiles = listFiles('src/pages', (file) => {
    const normalized = rel(file);
    return ['.astro', '.ts'].includes(extname(file)) && !normalized.includes('/api/');
  });

  for (const file of pageFiles) {
    const normalized = rel(file);
    const content = read(file);
    const hasPrerenderTrue = /export\s+const\s+prerender\s*=\s*true/.test(content);
    const isStatic = isStaticPrerenderRoute(normalized);

    if (isStatic && existsSync(resolve(file)) && !hasPrerenderTrue) {
      findings.push(makeFinding(
        'D-03',
        'P1',
        normalized,
        'Static route missing `export const prerender = true`.',
        'Add `export const prerender = true` to the static route. See Section 38.2 D-03.',
        findLine(content, '---'),
      ));
    }
    if (!isStatic && hasPrerenderTrue) {
      findings.push(makeFinding(
        'D-03',
        'P0',
        normalized,
        'Dynamic route must not set `export const prerender = true` (server output default).',
        'Remove prerender = true. Dynamic routes omit the flag per Section 3.4. See Section 38.2 D-03.',
        findLine(content, 'prerender'),
      ));
    }
  }
  return findings;
}

function migrationBases(): string[] {
  return readdirSync(resolve('db/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}_.*\.sql$/.test(entry.name))
    .map((entry) => entry.name.match(/^(\d{4})_/)?.[1] ?? '')
    .filter(Boolean);
}

const checks: Check[] = [
  { code: 'D-01', severity: 'P0', fix: 'Replace with `output: \'server\'`. See Section 38.2 D-01.', run: () => withMeta({ code: 'D-01', severity: 'P0', fix: 'Replace with `output: \'server\'`. See Section 38.2 D-01.' }, runRg("output:\\s*['\"](static|hybrid)['\"]", ['--glob', '!**/*.md', '-t', 'ts', '-t', 'tsx', '-t', 'js', '-t', 'mjs'])) },
  { code: 'D-02', severity: 'P1', fix: 'Delete the line. See Section 38.2 D-02.', run: () => withMeta({ code: 'D-02', severity: 'P1', fix: 'Delete the line. See Section 38.2 D-02.' }, runRg('prerender\\s*=\\s*false', ['src/pages/', '--glob', '!**/*.md'])) },
  { code: 'D-03', severity: 'P1', fix: 'Static routes need prerender = true; dynamic routes must omit it. See Section 3.4 / 38.2 D-03.', run: () => prerenderRouteChecks() },
  { code: 'D-04', severity: 'P0', fix: 'Replace with abandoned_email_sent_at. See Section 38.2 D-04.', run: () => withMeta({ code: 'D-04', severity: 'P0', fix: 'Replace with abandoned_email_sent_at. See Section 38.2 D-04.' }, runRg('abandoned_1h_sent_at|abandoned_24h_sent_at', ['-t', 'ts', '-t', 'sql', '-t', 'md'])) },
  { code: 'D-05', severity: 'P1', fix: 'Ensure every CartDO mutation arms the 5-minute alarm. See Section 38.2 D-05.', run: () => {
    const content = read('src/do/cart-do.ts');
    return content.includes('setAlarm(Date.now() + 5 * 60 * 1000)') ? [] : [makeFinding('D-05', 'P1', 'src/do/cart-do.ts', 'CartDO mutation path does not arm the 5-minute alarm.', 'Ensure every CartDO mutation arms the 5-minute alarm. See Section 38.2 D-05.')];
  } },
  { code: 'D-06', severity: 'P1', fix: 'Keep cart_activity writes out of CartDO mutation methods. See Section 38.2 D-06.', run: () => {
    const content = read('src/do/cart-do.ts');
    const mutationBlock = content.slice(0, content.indexOf('async alarm(): Promise<void>'));
    return mutationBlock.includes('INSERT INTO cart_activity') ? [makeFinding('D-06', 'P1', 'src/do/cart-do.ts', 'CartDO mutation path appears to write cart_activity synchronously.', 'Keep cart_activity writes out of CartDO mutation methods. See Section 38.2 D-06.')] : [];
  } },
  { code: 'D-07', severity: 'P1', fix: 'Add reverseDirectSale and contract implementation. See Section 38.2 D-07.', run: () => {
    const content = read('src/do/variant-inventory-do.ts');
    if (content.includes('reverseDirectSale') && content.includes('implements DurableObject, VariantInventoryDOContract')) return [];
    return [makeFinding('D-07', 'P1', 'src/do/variant-inventory-do.ts', 'VariantInventoryDO missing reverseDirectSale or contract implementation.', 'Add reverseDirectSale and contract implementation. See Section 38.2 D-07.')];
  } },
  { code: 'D-08', severity: 'P1', fix: 'Ensure POS compensates with reverseDirectSale on invoice write failure. See Section 38.2 D-08.', run: () => {
    const content = read('src/lib/invoices.ts');
    return content.includes('compensateDirectSales') && content.includes('doReverseDirectSale') ? [] : [makeFinding('D-08', 'P1', 'src/lib/invoices.ts', 'POS compensation path missing reverseDirectSale handling.', 'Ensure POS compensates with reverseDirectSale on invoice write failure. See Section 38.2 D-08.')];
  } },
  { code: 'D-09', severity: 'P1', fix: 'Move FraudBD HTTP calls into the provider adapter. See Section 38.2 D-09.', run: () => withMeta({ code: 'D-09', severity: 'P1', fix: 'Move FraudBD HTTP calls into the provider adapter. See Section 38.2 D-09.' }, runRg('fetch\\(.*fraudbd', ['src/', '--glob', '!src/lib/integrations/fraudbd/**'])) },
  { code: 'D-10', severity: 'P1', fix: 'Delete checkout retry logic for FraudBD. See Section 38.2 D-10.', run: () => withMeta({ code: 'D-10', severity: 'P1', fix: 'Delete checkout retry logic for FraudBD. See Section 38.2 D-10.' }, runRg('retry', ['src/lib/fraud.ts', 'src/lib/integrations/fraudbd/client.ts'])) },
  { code: 'D-11', severity: 'P1', fix: 'Set checkout FraudBD timeout to exactly 1500ms. See Section 38.2 D-11.', run: () => {
    const content = read('src/lib/fraud.ts');
    return content.includes('timeoutMs = 1500') ? [] : [makeFinding('D-11', 'P1', 'src/lib/fraud.ts', 'FraudBD checkout timeout is not 1500ms.', 'Set checkout FraudBD timeout to exactly 1500ms. See Section 38.2 D-11.')];
  } },
  { code: 'D-12', severity: 'P1', fix: 'Set fraud-audit queue timeout to 3000ms. See Section 38.2 D-12.', run: () => {
    const content = read('src/queues/consumers.ts');
    return content.includes('checkFraudBD(msg.body.phone, env.FRAUDBD_API_KEY, 3000') ? [] : [makeFinding('D-12', 'P1', 'src/queues/consumers.ts', 'Fraud-audit queue is not using a 3000ms timeout.', 'Set fraud-audit queue timeout to 3000ms. See Section 38.2 D-12.')];
  } },
  { code: 'D-13', severity: 'P1', fix: 'Branch email provider selection on env.EMAIL_PROVIDER. See Section 38.2 D-13.', run: () => {
    const content = read('src/lib/integrations/email/index.ts');
    return content.includes('EMAIL_PROVIDER') ? [] : [makeFinding('D-13', 'P1', 'src/lib/integrations/email/index.ts', 'EMAIL_PROVIDER is not used in the email provider factory.', 'Branch email provider selection on env.EMAIL_PROVIDER. See Section 38.2 D-13.')];
  } },
  { code: 'D-14', severity: 'P1', fix: 'Add `implements EmailProvider` to email adapters. See Section 38.2 D-14.', run: () => {
    const files = ['src/lib/integrations/email/resend/index.ts', 'src/lib/integrations/email/cloudflare_email/index.ts'];
    return files.flatMap((file) => read(file).includes('implements EmailProvider') ? [] : [makeFinding('D-14', 'P1', file, 'Email adapter missing `implements EmailProvider`.', 'Add `implements EmailProvider` to email adapters. See Section 38.2 D-14.')]);
  } },
  { code: 'D-15', severity: 'P1', fix: 'Add canUseDeepSeek and recordUsage. See Section 38.2 D-15.', run: () => {
    const content = read('src/do/budget-counter-do.ts');
    return content.includes('canUseDeepSeek') && content.includes('recordUsage') ? [] : [makeFinding('D-15', 'P1', 'src/do/budget-counter-do.ts', 'BudgetCounterDO missing canUseDeepSeek or recordUsage.', 'Add canUseDeepSeek and recordUsage. See Section 38.2 D-15.')];
  } },
  { code: 'D-16', severity: 'P1', fix: 'Add DeepSeek budget pre-flight before generation. See Section 38.2 D-16.', run: () => {
    const content = read('src/pages/api/staff/ai/generate-product-content.ts');
    return content.includes('canUseDeepSeekBudget') ? [] : [makeFinding('D-16', 'P1', 'src/pages/api/staff/ai/generate-product-content.ts', 'DeepSeek generation path missing canUseDeepSeek pre-flight.', 'Add DeepSeek budget pre-flight before generation. See Section 38.2 D-16.')];
  } },
  { code: 'D-17', severity: 'P1', fix: 'Verify Origin and User-Agent in DirectCheckoutSessionDO methods. See Section 38.2 D-17.', run: () => {
    const content = read('src/do/direct-checkout-session-do.ts');
    return content.includes('ORIGIN_MISMATCH') && content.includes('USER_AGENT_MISMATCH') ? [] : [makeFinding('D-17', 'P1', 'src/do/direct-checkout-session-do.ts', 'DirectCheckoutSessionDO missing Origin/User-Agent verification.', 'Verify Origin and User-Agent in DirectCheckoutSessionDO methods. See Section 38.2 D-17.')];
  } },
  { code: 'D-18', severity: 'P1', fix: 'Delete DirectCheckoutSessionDO session after successful order creation. See Section 38.2 D-18.', run: () => {
    const content = read('src/pages/api/buy-now/submit.ts');
    return content.includes("https://do/clear") ? [] : [makeFinding('D-18', 'P1', 'src/pages/api/buy-now/submit.ts', 'Buy Now submit path does not clear the direct checkout session.', 'Delete DirectCheckoutSessionDO session after successful order creation. See Section 38.2 D-18.')];
  } },
  { code: 'D-19', severity: 'P0', fix: 'Compute VAT server-side from VAT_RATE_PERCENT. See Section 38.2 D-19.', run: () => {
    const content = read('src/pages/api/checkout.ts');
    return content.includes('VAT_RATE_PERCENT') && content.includes('vat_paisa') ? [] : [makeFinding('D-19', 'P0', 'src/pages/api/checkout.ts', 'Checkout VAT computation is missing from the server flow.', 'Compute VAT server-side from VAT_RATE_PERCENT. See Section 38.2 D-19.')];
  } },
  { code: 'D-20', severity: 'P0', fix: 'Strip browser-supplied VAT and recompute server-side. See Section 38.2 D-20.', run: () => {
    const content = read('src/lib/checkout-pricing.ts');
    return content.includes('vat_paisa') ? [] : [makeFinding('D-20', 'P0', 'src/lib/checkout-pricing.ts', 'Client-supplied VAT does not appear to be stripped.', 'Strip browser-supplied VAT and recompute server-side. See Section 38.2 D-20.')];
  } },
  { code: 'D-21', severity: 'P1', fix: 'Keep reservation cleanup on hourly schedule. See Section 38.2 D-21.', run: () => {
    const content = read('src/lib/cron-dispatch.ts');
    return content.includes("0 * * * *") ? [] : [makeFinding('D-21', 'P1', 'src/lib/cron-dispatch.ts', 'Reservation cleanup cron is not scheduled hourly.', 'Keep reservation cleanup on hourly schedule. See Section 38.2 D-21.')];
  } },
  { code: 'D-22', severity: 'P0', fix: 'Use the 15-minute release window with release_requested_at filter. See Section 38.2 D-22.', run: () => {
    const content = read('src/lib/inventory.ts');
    return content.includes("created_at < datetime('now', '-15 minutes')") && content.includes('release_requested_at IS NULL') ? [] : [makeFinding('D-22', 'P0', 'src/lib/inventory.ts', 'Reservation cleanup query does not match the 15-minute release window contract.', 'Use the 15-minute release window with release_requested_at filter. See Section 38.2 D-22.')];
  } },
  { code: 'D-23', severity: 'P0', fix: 'Ensure idx_stock_reservations_order_active exists. See Section 38.2 D-23.', run: () => {
    const files = ['db/migrations/0024_stock_reservations_unique_constraint.sql', 'db/migrations/0027_stock_reservations_status_rebuild.sql'];
    return files.every((file) => read(file).includes('idx_stock_reservations_order_active')) ? [] : [makeFinding('D-23', 'P0', 'db/migrations', 'Active reservation unique index definition is missing from migrations.', 'Ensure idx_stock_reservations_order_active exists. See Section 38.2 D-23.')];
  } },
  { code: 'D-24', severity: 'P0', fix: 'Ensure stock_reservations includes release_requested_at. See Section 38.2 D-24.', run: () => {
    const files = ['db/migrations/0024_stock_reservations_unique_constraint.sql', 'db/migrations/0027_stock_reservations_status_rebuild.sql'];
    return files.every((file) => read(file).includes('release_requested_at')) ? [] : [makeFinding('D-24', 'P0', 'db/migrations', 'release_requested_at column is missing from reservation migrations.', 'Ensure stock_reservations includes release_requested_at. See Section 38.2 D-24.')];
  } },
  { code: 'D-25', severity: 'P0', fix: 'Ensure otp_secrets, api_audit_logs, and ai_budget_limits migrations exist. See Section 38.2 D-25.', run: () => {
    const required = ['db/migrations/0021_create_otp_secrets.sql', 'db/migrations/0022_create_api_audit_logs.sql', 'db/migrations/0023_create_ai_budget_limits.sql'];
    return required.filter((file) => !existsSync(resolve(file))).map((file) => makeFinding('D-25', 'P0', file, 'Required schema migration file is missing.', 'Ensure otp_secrets, api_audit_logs, and ai_budget_limits migrations exist. See Section 38.2 D-25.'));
  } },
  { code: 'D-26', severity: 'P1', fix: 'Wire the cart-activity queue and keep CartDO publishing to it. See Section 38.2 D-26.', run: () => {
    const wrangler = read('wrangler.jsonc');
    const cartDo = read('src/do/cart-do.ts');
    return wrangler.includes('cart-activity') && cartDo.includes('CART_ACTIVITY.send') ? [] : [makeFinding('D-26', 'P1', 'wrangler.jsonc', 'cart-activity queue is not fully wired or published to.', 'Wire the cart-activity queue and keep CartDO publishing to it. See Section 38.2 D-26.')];
  } },
  { code: 'D-27', severity: 'P1', fix: 'Deduplicate abandoned-cart emails by customer_email window. See Section 38.2 D-27.', run: () => {
    const content = read('src/queues/consumers.ts');
    return content.includes('ROW_NUMBER() OVER (PARTITION BY customer_email') ? [] : [makeFinding('D-27', 'P1', 'src/queues/consumers.ts', 'Abandoned-cart scan is missing customer_email deduplication.', 'Deduplicate abandoned-cart emails by customer_email window. See Section 38.2 D-27.')];
  } },
  { code: 'D-28', severity: 'P0', fix: 'Filter abandoned-cart sends to consent_status = allowed. See Section 38.2 D-28.', run: () => {
    const content = read('src/queues/consumers.ts');
    return content.includes("consent_status = 'allowed'") ? [] : [makeFinding('D-28', 'P0', 'src/queues/consumers.ts', 'Abandoned-cart scan is missing the consent_status filter.', 'Filter abandoned-cart sends to consent_status = allowed. See Section 38.2 D-28.')];
  } },
  { code: 'D-29', severity: 'P0', fix: 'Use integer paisa types; only BudgetCounterDO.cost_usd is allowed as float. See Section 38.2 D-29.', run: () => {
    const findings = withMeta({ code: 'D-29', severity: 'P0', fix: 'Use integer paisa types; only BudgetCounterDO.cost_usd is allowed as float. See Section 38.2 D-29.' }, runRg('(price|cost|subtotal|total|delivery|discount|advance|balance|refund|vat).*\\b(REAL|FLOAT|DOUBLE)\\b', ['db/migrations']));
    return findings.filter((finding) => !finding.snippet.includes('cost_usd'));
  } },
  { code: 'D-30', severity: 'P2', fix: 'Review staging logs for PII leakage and redact at the sink. See Section 38.2 D-30.', run: () => [] },
  { code: 'D-31', severity: 'P0', fix: 'Add HMAC verification to payment webhook handlers. See Section 38.2 D-31.', run: () => {
    const webhookFiles = listFiles('src/pages/api', (file) => /webhook/i.test(file) && ['.ts', '.tsx'].includes(extname(file)));
    return webhookFiles.flatMap((file) => {
      const content = read(file);
      return /verifyHmac|verify.*signature|HMAC/i.test(content) ? [] : [makeFinding('D-31', 'P0', rel(file), 'Webhook handler missing HMAC verification.', 'Add HMAC verification to payment webhook handlers. See Section 38.2 D-31.')];
    });
  } },
  { code: 'D-32', severity: 'P1', fix: 'Ensure staff routes have RBAC middleware and Cloudflare Access. See Section 38.2 D-32.', run: () => {
    const routes = listFiles('src/pages/api/staff', (file) => ['.ts', '.tsx'].includes(extname(file)));
    return routes.flatMap((file) => {
      const normalized = rel(file);
      if (normalized.endsWith('/login.ts') || normalized.endsWith('/logout.ts')) return [];
      const content = read(file);
      return /requireAuth|requirePermission|RbacError/.test(content) ? [] : [makeFinding('D-32', 'P1', rel(file), 'Staff API route appears to be missing RBAC middleware.', 'Ensure staff routes have RBAC middleware and Cloudflare Access. See Section 38.2 D-32.')];
    });
  } },
  { code: 'D-33', severity: 'P1', fix: 'Move external HTTP calls into provider adapters. See Section 38.2 D-33.', run: () => withMeta({ code: 'D-33', severity: 'P1', fix: 'Move external HTTP calls into provider adapters. See Section 38.2 D-33.' }, runRg("fetch\\(['\"]https://", ['src/', '--glob', '!src/lib/integrations/**'])) },
  { code: 'D-34', severity: 'P1', fix: 'Strip PII from AI prompts. See Section 38.2 D-34.', run: () => withMeta({ code: 'D-34', severity: 'P1', fix: 'Strip PII from AI prompts. See Section 38.2 D-34.' }, runRg('phone|address|customer_name|customer_phone|customer_email', ['src/lib/ai-content.ts', 'src/lib/ai-client.ts'])) },
  { code: 'D-35', severity: 'P0', fix: 'Add rollback files for every migration. See Section 38.2 D-35.', run: () => migrationBases().flatMap((base) => {
    const rollbackMatches = readdirSync(resolve('db/migrations/rollback')).some((name) => name.startsWith(`${base}_`) || name.startsWith(`${base}_rollback_`));
    return rollbackMatches ? [] : [makeFinding('D-35', 'P0', `db/migrations/${base}_*.sql`, 'Migration is missing a matching rollback file.', 'Add rollback files for every migration. See Section 38.2 D-35.')];
  }) },
];

function parseArgs(): { scope: string; output: string } {
  const args = process.argv.slice(2);
  let scope = 'weekly';
  let output = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope') scope = args[++i] ?? scope;
    else if (args[i] === '--output') output = args[++i] ?? output;
    else if (!args[i].startsWith('--') && scope === 'weekly') scope = args[i];
    else if (!args[i].startsWith('--') && !output) output = args[i];
  }
  const date = new Date().toISOString().slice(0, 10);
  return { scope, output: output || resolve('docs/audit', `drift-${date}-${scope}.md`) };
}

function renderReport(scope: string, findings: Finding[]): string {
  const bySeverity = {
    P0: findings.filter((f) => f.severity === 'P0'),
    P1: findings.filter((f) => f.severity === 'P1'),
    P2: findings.filter((f) => f.severity === 'P2'),
    P3: findings.filter((f) => f.severity === 'P3'),
  };
  const date = new Date().toISOString().slice(0, 10);
  const section = (severity: Severity) => bySeverity[severity].map((f) => `- [${f.code}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.snippet}\n  - Fix: ${f.fix}`).join('\n') || '(none)';
  return `# Drift Audit — ${date} — scope: ${scope}

- Total findings: ${findings.length}
- P0 (blocks merge): ${bySeverity.P0.length}
- P1 (fix before next release): ${bySeverity.P1.length}
- P2 (fix in normal workflow): ${bySeverity.P2.length}
- P3 (informational): ${bySeverity.P3.length}

## P0 findings

${section('P0')}

## P1 findings

${section('P1')}

## P2 findings

${section('P2')}

## P3 findings

${section('P3')}
`;
}

function main() {
  const { scope, output } = parseArgs();
  if (checks.length !== 35) {
    console.error(`audit-drift.ts: expected 35 checks, found ${checks.length}.`);
    console.error('Implement all checks from Section 38.2 before running this script.');
    process.exit(2);
  }
  const findings = checks.flatMap((check) => check.run());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderReport(scope, findings));
  console.log(`Drift audit written to ${output}`);
  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  const p2 = findings.filter((f) => f.severity === 'P2').length;
  const p3 = findings.filter((f) => f.severity === 'P3').length;
  console.log(`P0: ${p0}, P1: ${p1}, P2: ${p2}, P3: ${p3}`);
  if (p0 > 0) process.exit(1);
}

main();
