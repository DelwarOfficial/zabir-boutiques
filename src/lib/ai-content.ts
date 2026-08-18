import { DeepSeekClient } from './integrations/deepseek';
import { WorkersAIClient } from './integrations/workers_ai';

export interface ProductContext {
  name: string;
  category?: string;
  pricePaisa?: number;
  keyFeatures?: string[];
  targetAudience?: string;
  style?: string;
}

export interface GeneratedContent {
  description: string;
  metaTitle: string;
  metaDescription: string;
  /**
   * N-29: whether the model overran a cap and we had to trim it. The trimmed
   * output is always within the cap, so without this flag every provider looks
   * equally compliant — which is exactly the difference an A/B needs to see.
   */
  metaTitleOverran?: boolean;
  metaDescriptionOverran?: boolean;
}

function buildProductPrompt(product: ProductContext): string {
  return `You are an e-commerce copywriter for Zabir Boutiques, a Bangladeshi fashion and lifestyle brand.

Generate SEO-optimized product content in English (with occasional Bengali terms where natural) for:

Product Name: ${product.name}
${product.category ? `Category: ${product.category}` : ''}
${product.pricePaisa ? `Price: ৳${(product.pricePaisa / 100).toFixed(0)}` : ''}
${product.keyFeatures?.length ? `Key Features: ${product.keyFeatures.join(', ')}` : ''}
${product.targetAudience ? `Target Audience: ${product.targetAudience}` : ''}
${product.style ? `Style: ${product.style}` : ''}

Return ONLY valid JSON with these fields:
- description: 2-3 paragraphs of persuasive product description (150-250 words total)
- metaTitle: SEO title (max 60 characters)
- metaDescription: SEO meta description (max 160 characters)`;
}

/**
 * SEO field caps (Section 23 / 24.1). These are not style preferences: a
 * metaTitle over ~60 chars or a metaDescription over ~160 is truncated
 * mid-word in search results, which is worse than a shorter one written to fit.
 */
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 40;

export class AIContentError extends Error {
  constructor(message: string, readonly code: 'UNPARSEABLE_RESPONSE' | 'INCOMPLETE_CONTENT') {
    super(message);
    this.name = 'AIContentError';
  }
}

/**
 * Trim to a cap on a word boundary, so a field that overruns degrades to a
 * shorter sentence rather than a severed word.
 */
export function trimToLimit(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '');
}

/**
 * N-29: parse strictly and fail loudly.
 *
 * The previous implementation fell back to `cleaned.slice(0, 500)` whenever
 * JSON.parse threw — so a refusal, a preamble or a stray code fence was stored
 * verbatim AS the product description, with no signal that anything had gone
 * wrong. Staff review is required before publish (Section 24.1), but review
 * catches bad copy, not copy that was never generated. A generation that did
 * not produce usable content is an error the staff member should see and
 * retry, not a silently degraded result.
 */
export function parseContentResponse(raw: string): GeneratedContent {
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AIContentError('AI response was not valid JSON', 'UNPARSEABLE_RESPONSE');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AIContentError('AI response was not a JSON object', 'UNPARSEABLE_RESPONSE');
  }

  const obj = parsed as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const description = str(obj.description);
  const metaTitle = str(obj.metaTitle);
  const metaDescription = str(obj.metaDescription);

  if (description.length < DESCRIPTION_MIN || !metaTitle || !metaDescription) {
    throw new AIContentError('AI response was missing required content fields', 'INCOMPLETE_CONTENT');
  }

  return {
    description: description.split('\r\n').join('\n').trim(),
    metaTitle: trimToLimit(metaTitle, META_TITLE_MAX),
    metaDescription: trimToLimit(metaDescription, META_DESCRIPTION_MAX),
  };
}

export async function generateProductContent(
  product: ProductContext,
  env: { DEEPSEEK_API_KEY?: string; DEEPSEEK_BASE_URL?: string; AI?: Ai },
  preferred: 'deepseek' | 'workers_ai' = 'workers_ai'
): Promise<GeneratedContent & { provider: 'deepseek' | 'workers_ai'; tokens_used: number; cost_usd: number }> {
  const prompt = buildProductPrompt(product);
  // Workers AI is primary for product descriptions (Master Plan 24.1).
  // DeepSeek is the secondary provider, used when explicitly requested or when
  // Workers AI is unavailable/over budget.
  if (preferred === 'deepseek' && env.DEEPSEEK_API_KEY) {
    const result = await new DeepSeekClient(env).generateProductDescription(prompt);
    return { ...parseContentResponse(result.text), provider: 'deepseek', tokens_used: result.tokens_used, cost_usd: result.cost_usd };
  }
  const fallback = await new WorkersAIClient(env as unknown as { AI?: Ai; DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }).generateProductDescription(prompt);
  return { ...parseContentResponse(fallback.text), provider: 'workers_ai', tokens_used: fallback.tokens_used, cost_usd: fallback.cost_usd };
}
