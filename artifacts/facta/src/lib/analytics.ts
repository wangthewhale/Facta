/**
 * Lightweight, replaceable analytics wrapper.
 * Swap the `send` implementation for GA/Plausible/PostHog later.
 * Analytics failures must never break the app — everything is try/catch'd.
 */
export type AnalyticsEvent =
  | 'hero_free_analysis_clicked'
  | 'sample_report_viewed'
  | 'scan_started'
  | 'invalid_barcode_detected'
  | 'unverified_barcode_detected'
  | 'photo_selected'
  | 'unknown_barcode_detected'
  | 'analysis_completed'
  | 'family_check_offer_viewed'
  | 'family_check_checkout_clicked'
  | 'analysis_abandoned'
  | 'product_saved'
  | 'product_unsaved'
  | 'share_started'
  | 'share_completed'
  | 'share_link_copied'
  | 'decision_cta_clicked'
  | 'decision_outcome_selected'
  | 'decision_outcome_saved'
  | 'decision_outcome_failed'
  | 'alternative_empty_cta_clicked';

export function track(event: AnalyticsEvent, props?: Record<string, string | number | boolean | null>) {
  try {
    const payload = { event, ts: Date.now(), ...props };
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[analytics]', payload);
    }
    // Replaceable transport: window.factaAnalytics can be injected by any provider
    const w = window as any;
    if (typeof w.factaAnalytics === 'function') {
      w.factaAnalytics(payload);
    }
  } catch {
    // never throw from analytics
  }
}
