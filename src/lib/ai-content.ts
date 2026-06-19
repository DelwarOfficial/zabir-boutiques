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

function parseContentResponse(raw: string, fallbackName: string): GeneratedContent {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').trim();
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

export async function generateProductContent(
  product: ProductContext,
  env: { DEEPSEEK_API_KEY?: string; DEEPSEEK_BASE_URL?: string; AI?: Ai },
  preferred: 'deepseek' | 'workers_ai' = 'deepseek'
): Promise<GeneratedContent & { provider: 'deepseek' | 'workers_ai'; tokens_used: number; cost_usd: number }> {
  const prompt = buildProductPrompt(product);
  if (preferred === 'deepseek' && env.DEEPSEEK_API_KEY) {
    const result = await new DeepSeekClient(env).generateProductDescription(prompt);
    return { ...parseContentResponse(result.text, product.name), provider: 'deepseek', tokens_used: result.tokens_used, cost_usd: result.cost_usd };
  }
  const fallback = await new WorkersAIClient(env as unknown as { AI?: Ai; DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }).generateProductDescription(prompt);
  return { ...parseContentResponse(fallback.text, product.name), provider: 'workers_ai', tokens_used: fallback.tokens_used, cost_usd: fallback.cost_usd };
}
