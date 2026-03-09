type RuntimeValidationResult = {
  ok: true;
};

let validationResult: RuntimeValidationResult | null = null;

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isAbsoluteHttpUrl(value: string | undefined) {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

function getNodeEnv() {
  return (process.env.NODE_ENV ?? "development").trim().toLowerCase();
}

function getLensSource() {
  return (
    process.env.LENS_POSTS_SOURCE?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE?.trim().toLowerCase() ||
    "local"
  );
}

function getStateBackend() {
  return (process.env.CHAINSOCIAL_STATE_BACKEND ?? "file").trim().toLowerCase();
}

function getMediaBackend() {
  return (process.env.CHAINSOCIAL_MEDIA_BACKEND ?? "local").trim().toLowerCase();
}

function getAdminToken() {
  return process.env.CHAINSOCIAL_ADMIN_TOKEN?.trim() ?? "";
}

function getAdminAddresses() {
  return (process.env.CHAINSOCIAL_ADMIN_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function collectRuntimeIssues() {
  const issues: string[] = [];
  const isProduction = getNodeEnv() === "production";
  const lensSource = getLensSource();
  const stateBackend = getStateBackend();
  const mediaBackend = getMediaBackend();
  const rawChainOnlyWrites = process.env.CHAINSOCIAL_CHAIN_ONLY_WRITES;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const lensOrigin = process.env.LENS_ORIGIN?.trim();
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const allowFileStateInProduction = parseBoolean(
    process.env.CHAINSOCIAL_ALLOW_FILE_STATE_IN_PRODUCTION,
    false
  );
  const allowFileFailoverInProduction = parseBoolean(
    process.env.CHAINSOCIAL_ALLOW_FILE_FAILOVER_IN_PRODUCTION,
    false
  );
  const allowLocalRateLimitsInProduction = parseBoolean(
    process.env.CHAINSOCIAL_ALLOW_LOCAL_RATE_LIMITS_IN_PRODUCTION,
    false
  );
  const allowLocalMediaInProduction = parseBoolean(
    process.env.CHAINSOCIAL_ALLOW_LOCAL_MEDIA_IN_PRODUCTION,
    false
  );
  const allowLegacyAdminToken = parseBoolean(
    process.env.CHAINSOCIAL_ALLOW_LEGACY_ADMIN_TOKEN,
    false
  );

  if (!privyAppId) {
    issues.push("NEXT_PUBLIC_PRIVY_APP_ID is required.");
  }

  if (process.env.NEXT_PUBLIC_PINATA_JWT?.trim()) {
    issues.push("NEXT_PUBLIC_PINATA_JWT must not be set because it exposes an upload secret to clients.");
  }

  if (process.env.NEXT_PUBLIC_WEB3_STORAGE_TOKEN?.trim()) {
    issues.push(
      "NEXT_PUBLIC_WEB3_STORAGE_TOKEN must not be set because it exposes a storage secret to clients."
    );
  }

  if (stateBackend === "postgres" && !process.env.DATABASE_URL?.trim()) {
    issues.push("CHAINSOCIAL_STATE_BACKEND=postgres requires DATABASE_URL.");
  }

  if (mediaBackend === "remote") {
    const remoteUrl = process.env.CHAINSOCIAL_MEDIA_REMOTE_URL?.trim();
    if (!remoteUrl) {
      issues.push("CHAINSOCIAL_MEDIA_BACKEND=remote requires CHAINSOCIAL_MEDIA_REMOTE_URL.");
    } else if (isProduction && !remoteUrl.startsWith("https://")) {
      issues.push("CHAINSOCIAL_MEDIA_REMOTE_URL must use https in production.");
    }
  }

  if (
    ((isProduction && parseBoolean(process.env.CHAINSOCIAL_CHAIN_ONLY_WRITES, true)) ||
      (rawChainOnlyWrites !== undefined && parseBoolean(rawChainOnlyWrites, true))) &&
    lensSource !== "lens"
  ) {
    issues.push("CHAINSOCIAL_CHAIN_ONLY_WRITES=true requires LENS_POSTS_SOURCE=lens.");
  }

  if (lensSource === "lens") {
    if (!process.env.LENS_APP_ADDRESS?.trim()) {
      issues.push("LENS_POSTS_SOURCE=lens requires LENS_APP_ADDRESS for Lens auth flows.");
    }
  }

  if (!isProduction) {
    return issues;
  }

  if (!appUrl) {
    issues.push("NEXT_PUBLIC_APP_URL is required in production.");
  } else if (!isAbsoluteHttpUrl(appUrl) || !appUrl.startsWith("https://")) {
    issues.push("NEXT_PUBLIC_APP_URL must be an https URL in production.");
  }

  if (lensOrigin && (!isAbsoluteHttpUrl(lensOrigin) || !lensOrigin.startsWith("https://"))) {
    issues.push("LENS_ORIGIN must be an https URL in production.");
  }

  if (lensSource === "lens" && !lensOrigin && !appUrl) {
    issues.push("Lens mode requires LENS_ORIGIN or NEXT_PUBLIC_APP_URL in production.");
  }

  if (stateBackend !== "postgres" && !allowFileStateInProduction) {
    issues.push(
      "Production must use CHAINSOCIAL_STATE_BACKEND=postgres unless CHAINSOCIAL_ALLOW_FILE_STATE_IN_PRODUCTION=true is set explicitly."
    );
  }

  if (
    stateBackend === "postgres" &&
    parseBoolean(process.env.CHAINSOCIAL_STATE_FAILOVER_TO_FILE, true) &&
    !allowFileFailoverInProduction
  ) {
    issues.push(
      "CHAINSOCIAL_STATE_FAILOVER_TO_FILE must be disabled in production unless CHAINSOCIAL_ALLOW_FILE_FAILOVER_IN_PRODUCTION=true is set explicitly."
    );
  }

  if (
    (!process.env.UPSTASH_REDIS_REST_URL?.trim() || !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) &&
    !allowLocalRateLimitsInProduction
  ) {
    issues.push(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production unless CHAINSOCIAL_ALLOW_LOCAL_RATE_LIMITS_IN_PRODUCTION=true is set explicitly."
    );
  }

  if (mediaBackend !== "remote" && !allowLocalMediaInProduction) {
    issues.push(
      "CHAINSOCIAL_MEDIA_BACKEND=remote is required in production unless CHAINSOCIAL_ALLOW_LOCAL_MEDIA_IN_PRODUCTION=true is set explicitly."
    );
  }

  if (getAdminAddresses().length === 0) {
    issues.push("CHAINSOCIAL_ADMIN_ADDRESSES must contain at least one allowlisted operator wallet address in production.");
  }

  if (allowLegacyAdminToken && getAdminToken().length < 32) {
    issues.push(
      "CHAINSOCIAL_ADMIN_TOKEN must be at least 32 characters long when CHAINSOCIAL_ALLOW_LEGACY_ADMIN_TOKEN=true."
    );
  }

  return issues;
}

export function ensureRuntimeConfig() {
  if (validationResult) return validationResult;

  const issues = collectRuntimeIssues();
  if (issues.length > 0) {
    throw new Error(
      `Invalid ChainSocial runtime configuration:\n- ${issues.join("\n- ")}`
    );
  }

  validationResult = { ok: true };
  return validationResult;
}
