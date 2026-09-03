import { useSyncExternalStore } from 'react';
import { analyticsChoice, subscribeToAnalyticsChoice, type AnalyticsChoice } from './analytics';

/**
 * The analytics setting, kept in step across the notice and the footer control.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect because the value
 * lives outside React: `analytics.ts` owns it, `capture()` reads it on every
 * call, and both UI surfaces are subscribers rather than owners.
 */
export function useAnalyticsChoice(): AnalyticsChoice {
  return useSyncExternalStore(subscribeToAnalyticsChoice, analyticsChoice, () => null);
}
