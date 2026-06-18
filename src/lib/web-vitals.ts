/**
 * Web Vitals Monitoring [Master_Prompt v7.0 §21]
 *
 * Real User Monitoring (RUM) for Core Web Vitals.
 * Uses the web-vitals library to collect LCP, INP, CLS, and TTFB metrics.
 *
 * Usage: Import and call initWebVitals() in the layout.
 */

import { onLCP, onINP, onCLS, onTTFB, type Metric } from 'web-vitals';

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
 * Sends metrics to /api/analytics/vitals via sendBeacon.
 */
export function initWebVitals(callback?: WebVitalsCallback): void {
  if (typeof window === 'undefined') return;

  function handleMetric(metric: Metric) {
    const result: WebVitalMetric = {
      name: metric.name,
      value: metric.value,
      rating: metric.rating as 'good' | 'needs-improvement' | 'poor',
      id: metric.id,
      navigationType: metric.navigationType,
    };
    callback?.(result);
    sendToAnalytics(result);
  }

  onLCP(handleMetric);
  onINP(handleMetric);
  onCLS(handleMetric);
  onTTFB(handleMetric);
}

function sendToAnalytics(metric: WebVitalMetric): void {
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
