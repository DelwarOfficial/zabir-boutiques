/**
 * Web Vitals Monitoring [Master_Prompt v7.0 §21]
 *
 * Real User Monitoring (RUM) for Core Web Vitals.
 * This module should be loaded on public pages to collect
 * LCP, INP, CLS, and TTFB metrics.
 *
 * Usage: Import and call initWebVitals() in the layout.
 */

export interface WebVitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
  navigationType: string;
}

export type WebVitalsCallback = (metric: WebVitalMetric) => void;

/**
 * Initialize web vitals monitoring.
 * This is a placeholder implementation. In production, use the
 * web-vitals library: npm install web-vitals
 */
export function initWebVitals(callback?: WebVitalsCallback): void {
  if (typeof window === 'undefined') return;

  // Placeholder: In production, use web-vitals library
  // import { onLCP, onINP, onCLS, onTTFB } from 'web-vitals';
  //
  // onLCP((metric) => {
  //   const result = {
  //     name: 'LCP',
  //     value: metric.value,
  //     rating: metric.rating,
  //     id: metric.id,
  //     navigationType: metric.navigationType,
  //   };
  //   callback?.(result);
  //   sendToAnalytics(result);
  // });
  //
  // onINP((metric) => { ... });
  // onCLS((metric) => { ... });
  // onTTFB((metric) => { ... });

  console.log('[web-vitals] Monitoring initialized (placeholder)');
}

function sendToAnalytics(metric: WebVitalMetric): void {
  // Send to Cloudflare Analytics Engine or other analytics endpoint
  if (navigator.sendBeacon) {
    const body = JSON.stringify({
      type: 'web-vital',
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      page: window.location.pathname,
      timestamp: Date.now(),
    });
    navigator.sendBeacon('/api/analytics/vitals', body);
  }
}
