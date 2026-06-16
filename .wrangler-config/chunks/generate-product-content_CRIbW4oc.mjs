globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { r as requireAuth, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { w as writeAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
async function callDeepSeek(prompt, apiKey) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1e3
    })
  });
  if (!res.ok) throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
async function callOpenAI(prompt, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1e3
    })
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
function buildProductPrompt(product) {
  return `You are an e-commerce copywriter for Zabir Boutiques, a Bangladeshi fashion and lifestyle brand.

Generate SEO-optimized product content in English (with occasional Bengali terms where natural) for:

Product Name: ${product.name}
${product.category ? `Category: ${product.category}` : ""}
${product.pricePaisa ? `Price: ৳${(product.pricePaisa / 100).toFixed(0)}` : ""}
${product.keyFeatures?.length ? `Key Features: ${product.keyFeatures.join(", ")}` : ""}
${product.targetAudience ? `Target Audience: ${product.targetAudience}` : ""}
${product.style ? `Style: ${product.style}` : ""}

Return ONLY valid JSON with these fields:
- description: 2-3 paragraphs of persuasive product description (150-250 words total)
- metaTitle: SEO title (max 60 characters)
- metaDescription: SEO meta description (max 160 characters)`;
}
function parseContentResponse(raw, fallbackName) {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const descMatch = cleaned.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const titleMatch = cleaned.match(/"metaTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const metaMatch = cleaned.match(/"metaDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      description: descMatch?.[1] ?? cleaned.slice(0, 500),
      metaTitle: titleMatch?.[1] ?? fallbackName,
      metaDescription: metaMatch?.[1] ?? cleaned.slice(0, 160)
    };
  }
}
async function generateProductContent(product, deepseekKey, openaiKey, preferred = "deepseek") {
  const prompt = buildProductPrompt(product);
  let raw;
  if (preferred === "deepseek" && deepseekKey) {
    raw = await callDeepSeek(prompt, deepseekKey);
  } else if (openaiKey) {
    raw = await callOpenAI(prompt, openaiKey);
  } else if (deepseekKey) {
    raw = await callDeepSeek(prompt, deepseekKey);
  } else {
    throw new Error("No AI API key configured");
  }
  return parseContentResponse(raw, product.name);
}
const prerender = false;
async function POST(context) {
  const env = getEnv();
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "products.manage");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "Product name is required" }, { status: 400 });
  }
  try {
    const budgetKey = "AI_MONTHLY_USAGE_COUNT";
    const AI_MONTHLY_CAP = 200;
    const currentUsage = parseInt(await env.CACHE.get(budgetKey) ?? "0", 10);
    if (currentUsage >= AI_MONTHLY_CAP) {
      return Response.json({ ok: false, error: "AI generation budget exhausted for this month." }, { status: 429 });
    }
    const content = await generateProductContent(
      {
        name,
        category: body.category,
        pricePaisa: body.price_paisa,
        keyFeatures: body.key_features,
        targetAudience: body.target_audience,
        style: body.style
      },
      env.DEEPSEEK_API_KEY,
      env.OPENAI_API_KEY,
      body.provider ?? "deepseek"
    );
    await writeAuditLog(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: "ai.product_content.generate",
      entityType: "product",
      entityId: name,
      metadata: { provider: body.provider ?? "deepseek" },
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request)
    });
    await env.CACHE.put(budgetKey, String(currentUsage + 1), { expirationTtl: 35 * 24 * 60 * 60 });
    return Response.json({ ok: true, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI generation failed";
    console.error("[ai/generate-product-content]", err);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
