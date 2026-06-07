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

async function callDeepSeek(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });
  if (!res.ok) throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
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
  deepseekKey: string,
  openaiKey: string,
  preferred: 'deepseek' | 'openai' = 'deepseek'
): Promise<GeneratedContent> {
  const prompt = buildProductPrompt(product);
  let raw: string;
  if (preferred === 'deepseek' && deepseekKey) {
    raw = await callDeepSeek(prompt, deepseekKey);
  } else if (openaiKey) {
    raw = await callOpenAI(prompt, openaiKey);
  } else if (deepseekKey) {
    raw = await callDeepSeek(prompt, deepseekKey);
  } else {
    throw new Error('No AI API key configured');
  }
  return parseContentResponse(raw, product.name);
}
