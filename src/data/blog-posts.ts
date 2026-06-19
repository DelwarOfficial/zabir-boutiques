export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  category: string;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'cotton-saree-care',
    title: 'How to Care for Cotton Sarees',
    excerpt: 'Simple washing and storage tips to keep boutique cotton sarees fresh for years.',
    publishedAt: '2026-05-12',
    category: 'Care Guide',
  },
  {
    slug: 'dhaka-delivery-tips',
    title: 'Inside Dhaka Delivery Tips',
    excerpt: 'What to expect for inside-Dhaka boutique deliveries and how we pack fragile pieces.',
    publishedAt: '2026-05-28',
    category: 'Shipping',
  },
];