//lib/lens.ts

import axios from "axios";
import { logger } from "@/lib/server/logger";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

type GraphQLError = { message: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLError[];
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldLogLensRequests() {
  const raw = process.env.CHAINSOCIAL_LENS_DEBUG?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return process.env.NODE_ENV !== "production";
}

function getLensApiCandidates() {
  // Lens v3 uses api.lens.xyz/graphql as the primary endpoint
  const envUrl = process.env.LENS_API_URL?.trim();
  
  // Only trust known Lens API domains to prevent SSRF via env injection
  const TRUSTED_LENS_HOSTS = new Set([
    "api.lens.xyz",
    "api.lens.dev",
    "api-v2.lens.dev",
  ]);

  // Ensure URL ends with /graphql
  const normalizeUrl = (url: string | undefined): string | null => {
    if (!url || url.length === 0) return null;
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    // Add /graphql if not present
    if (!url.endsWith('/graphql')) {
      url = `${url}/graphql`;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return null;
      if (!TRUSTED_LENS_HOSTS.has(parsed.hostname)) {
        logger.warn("lens.untrusted_api_host", { hostname: parsed.hostname });
        return null;
      }
    } catch {
      return null;
    }
    return url;
  };
  
  const normalized = normalizeUrl(envUrl);
  const defaultUrl = "https://api.lens.xyz/graphql";
  
  const urls: string[] = [];
  if (normalized) urls.push(normalized);
  if (!urls.includes(defaultUrl)) urls.push(defaultUrl);

  if (shouldLogLensRequests()) {
    logger.debug("lens.api_candidates", { urls });
  }
  return urls;
}

export async function lensRequest<TData = Record<string, unknown>, TVariables = Record<string, unknown>>(
  query: string,
  variables?: TVariables,
  accessToken?: string
): Promise<TData> {
  ensureRuntimeConfig();
  const appOrigin =
    process.env.LENS_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  const referer = appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`;

  const candidates = getLensApiCandidates();
  const requestTimeoutMs = parsePositiveInt(process.env.CHAINSOCIAL_LENS_TIMEOUT_MS, 8000);
  
  if (candidates.length === 0) {
    throw new Error(`Lens request failed: No endpoints available`);
  }
  
  // Try primary endpoint first with shorter timeout, then fall back to others
  const primaryUrl = candidates[0];
  let primaryError: Error | null = null;
  
  try {
    return await makeRequest<TData>(
      primaryUrl,
      query,
      variables,
      accessToken,
      appOrigin,
      referer,
      requestTimeoutMs
    );
  } catch (err) {
    primaryError = err instanceof Error ? err : new Error(String(err));
    // if the error clearly indicates the account is still onboarding we
    // propagate it immediately rather than continuing to hit other hosts.
    if (primaryError.message.includes("ONBOARDING_USER")) {
      throw primaryError;
    }
    // otherwise fall through to backup attempts
  }

  // Try remaining endpoints in parallel
  const backupUrls = candidates.slice(1);
  if (backupUrls.length === 0) {
    // No backups, rethrow the primary error
    throw primaryError || new Error("Lens request failed");
  }

  const results = await Promise.allSettled(
    backupUrls.map((url) =>
      makeRequest<TData>(
        url,
        query,
        variables,
        accessToken,
        appOrigin,
        referer,
        requestTimeoutMs
      )
    )
  );

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  // All failed – inspect for onboarding-specific message first
  const failures = results.map((r) =>
    r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'unknown'
  );

  const onboarding = failures.find((m) => m.includes("ONBOARDING_USER"));
  if (onboarding) {
    throw new Error(onboarding);
  }

  throw new Error(`Lens request failed across all endpoints: ${failures.join(' | ')}`);
}

async function makeRequest<TData>(
  url: string,
  query: string,
  variables: unknown,
  accessToken: string | undefined,
  appOrigin: string,
  referer: string,
  timeout: number
): Promise<TData> {
  // Keep logs minimal to avoid leaking tokens/signatures in production logs.
  if (shouldLogLensRequests()) {
    logger.debug("lens.request", {
      url,
      hasAccessToken: !!accessToken,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: appOrigin,
    Referer: referer,
  };
  
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await axios.post<GraphQLResponse<TData>>( 
    url,
    { query, variables },
    {
      headers,
      timeout,
    }
  );

  const contentType = String(response.headers["content-type"] ?? "");
  const isJsonLike =
    contentType.includes("application/json") ||
    contentType.includes("application/graphql-response+json") ||
    contentType.includes("+json");
  if (!isJsonLike) {
    throw new Error(`non-JSON response (${contentType || "unknown content-type"})`);
  }

  if (response.data.errors && response.data.errors.length > 0) {
    const message = response.data.errors[0]?.message ?? "Lens GraphQL request failed";
    throw new Error(message);
  }

  if (!response.data.data) {
    const preview = JSON.stringify(response.data).slice(0, 200);
    throw new Error(`missing data (${preview || "empty response"})`);
  }

  return response.data.data;
}
