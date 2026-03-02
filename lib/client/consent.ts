export const CONSENT_STORAGE_KEY = "chainsocial:consent";

export type ConsentState = {
  required: true;
  functional: boolean;
  analytics: boolean;
  updatedAt: string;
};

function defaultConsent(): ConsentState {
  return {
    required: true,
    functional: false,
    analytics: false,
    updatedAt: new Date(0).toISOString(),
  };
}

export function readConsent(): ConsentState {
  if (typeof window === "undefined") return defaultConsent();
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return defaultConsent();
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    return {
      required: true,
      functional: !!parsed.functional,
      analytics: !!parsed.analytics,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return defaultConsent();
  }
}

export function writeConsent(next: Omit<ConsentState, "required" | "updatedAt">) {
  if (typeof window === "undefined") return;
  const payload: ConsentState = {
    required: true,
    functional: next.functional,
    analytics: next.analytics,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event("chainsocial:consent-changed"));
}

export function hasFunctionalConsent() {
  return readConsent().functional;
}

export function hasAnalyticsConsent() {
  return readConsent().analytics;
}
