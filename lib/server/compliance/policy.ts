export type ComplianceFeatureKey =
  | "lens"
  | "posts"
  | "follows"
  | "media_uploads"
  | "messages"
  | "notifications";

export type CompliancePolicy = {
  globalReadOnly: boolean;
  blockedCountries: Set<string>;
  writeBlockedCountries: Set<string>;
  featureDisabledCountries: Partial<Record<ComplianceFeatureKey, Set<string>>>;
  featuresDisabledGlobally: Partial<Record<ComplianceFeatureKey, boolean>>;
};

export type ComplianceDecision =
  | { allow: true }
  | {
      allow: false;
      status: 403 | 451 | 503;
      code:
        | "COUNTRY_BLOCKED"
        | "WRITE_BLOCKED_IN_REGION"
        | "FEATURE_DISABLED"
        | "GLOBAL_READ_ONLY";
      message: string;
      country: string;
    };

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseBoolean(value: string | undefined, fallback = false) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseCountryList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length === 2)
  );
}

function pathMatches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function featureForPath(pathname: string): ComplianceFeatureKey | null {
  if (pathMatches(pathname, "/api/media/upload")) return "media_uploads";
  if (pathMatches(pathname, "/api/lens")) return "lens";
  if (pathMatches(pathname, "/api/posts")) return "posts";
  if (pathMatches(pathname, "/api/follows")) return "follows";

  if (pathMatches(pathname, "/messages") || pathMatches(pathname, "/api/messages")) return "messages";
  if (pathMatches(pathname, "/notifications") || pathMatches(pathname, "/api/notifications")) {
    return "notifications";
  }

  return null;
}

export function getRequestCountry(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-ip-country"),
    headers.get("cf-ipcountry"),
    headers.get("x-country-code"),
    headers.get("x-geo-country"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  }

  return "ZZ";
}

export function getCompliancePolicy(): CompliancePolicy {
  const features: ComplianceFeatureKey[] = [
    "lens",
    "posts",
    "follows",
    "media_uploads",
    "messages",
    "notifications",
  ];

  const featureDisabledCountries: Partial<Record<ComplianceFeatureKey, Set<string>>> = {};
  const featuresDisabledGlobally: Partial<Record<ComplianceFeatureKey, boolean>> = {};

  for (const feature of features) {
    const envKey = `CHAINSOCIAL_DISABLE_${feature.toUpperCase()}`;
    const regionEnvKey = `CHAINSOCIAL_DISABLE_${feature.toUpperCase()}_COUNTRIES`;
    featuresDisabledGlobally[feature] = parseBoolean(process.env[envKey], false);
    featureDisabledCountries[feature] = parseCountryList(process.env[regionEnvKey]);
  }

  return {
    globalReadOnly: parseBoolean(process.env.CHAINSOCIAL_GLOBAL_READ_ONLY, false),
    blockedCountries: parseCountryList(process.env.CHAINSOCIAL_BLOCKED_COUNTRIES),
    writeBlockedCountries: parseCountryList(process.env.CHAINSOCIAL_WRITE_BLOCKED_COUNTRIES),
    featureDisabledCountries,
    featuresDisabledGlobally,
  };
}

export function evaluateCompliance(input: {
  pathname: string;
  method: string;
  country: string;
  policy?: CompliancePolicy;
}): ComplianceDecision {
  const policy = input.policy ?? getCompliancePolicy();
  const method = input.method.toUpperCase();
  const country = input.country.toUpperCase();
  const pathname = input.pathname;

  if (policy.blockedCountries.has(country)) {
    return {
      allow: false,
      status: 451,
      code: "COUNTRY_BLOCKED",
      message: "This service is not currently available in your region.",
      country,
    };
  }

  if (policy.globalReadOnly && UNSAFE_METHODS.has(method) && pathname.startsWith("/api/")) {
    return {
      allow: false,
      status: 503,
      code: "GLOBAL_READ_ONLY",
      message: "Write operations are temporarily disabled for compliance maintenance.",
      country,
    };
  }

  if (
    UNSAFE_METHODS.has(method) &&
    pathname.startsWith("/api/") &&
    policy.writeBlockedCountries.has(country)
  ) {
    return {
      allow: false,
      status: 451,
      code: "WRITE_BLOCKED_IN_REGION",
      message: "Write operations are restricted in your region.",
      country,
    };
  }

  const feature = featureForPath(pathname);
  if (!feature) return { allow: true };

  if (policy.featuresDisabledGlobally[feature]) {
    return {
      allow: false,
      status: 503,
      code: "FEATURE_DISABLED",
      message: `This feature (${feature}) is temporarily disabled.`,
      country,
    };
  }

  if (policy.featureDisabledCountries[feature]?.has(country)) {
    return {
      allow: false,
      status: 451,
      code: "FEATURE_DISABLED",
      message: `This feature (${feature}) is not available in your region.`,
      country,
    };
  }

  return { allow: true };
}
