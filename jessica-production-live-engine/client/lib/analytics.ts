/**
 * Analytic tracking stubs for system monitoring.
 * Dynamically hooks up Google Analytics 4 (GA4) in production.
 */

declare global {
  interface Window {
    dataLayer: any[];
    gtag?: (...args: any[]) => void;
  }
}

export const initGA = () => {
  const measurementId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || "G-1M3YSXW2QD";
  const isProd = import.meta.env.PROD;

  if (!measurementId) {
    console.warn("📊 [Analytics] Initialization skipped: VITE_GA_MEASUREMENT_ID is not configured.");
    return;
  }

  if (!isProd) {
    console.log(`📊 [Analytics] Initialization skipped (Development Mode). ID: ${measurementId}`);
    return;
  }

  if (typeof window === "undefined") return;

  // Prevent double initialization
  if (window.gtag) return;

  try {
    // 1. Inject script tag
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);

    // 2. Setup dataLayer and global gtag function
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };

    // 3. Configure Google Analytics
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      page_path: window.location.pathname,
      send_page_view: false, // Tracked manually on scene transitions
    });

    console.log(`📊 [Analytics] Google Analytics 4 initialized successfully with ID: ${measurementId}`);
  } catch (error) {
    console.error("📊 [Analytics] Failed to initialize Google Analytics:", error);
  }
};

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  console.log(`[Analytics] ${eventName}`, properties);
  
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", eventName, properties);
  }
};

export const TRACK_EVENTS = {
  STARTED_APP: 'started_application',
  VEHICLE_PICKED: 'vehicle_type_selected',
  STEP_COMPLETED: 'step_completed',
  FORM_SUBMITTED: 'form_submitted',
  LEAD_CAPTURE_SUCCESS: 'lead_capture_success',
  LEAD_CAPTURE_FAIL: 'lead_capture_fail',
  PROCESSING_STARTED: 'processing_started',
  PROCESSING_COMPLETED: 'processing_completed',
  PROCESSING_TIMEOUT_TRIGGERED: 'processing_timeout_triggered',
  RESULT_SHOWN: 'result_shown',
  CTA_CLICKED: 'cta_clicked'
};
import { collectAndEnrichForensics } from './deviceForensics';

export const syncLeadData = async (data: any, type: 'PARTIAL' | 'FINAL') => {
  try {
    // Collect device forensics (cached, non-blocking)
    let forensics_json: string | null = null;
    try {
      forensics_json = await collectAndEnrichForensics();
    } catch { /* Non-critical */ }

    await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, forensics_json, leadType: type, timestamp: new Date().toISOString() })
    });
  } catch (e) {
    console.warn("Lead sync failed (non-critical)", e);
  }
};

