//lib/lens.ts

import axios from "axios";

type GraphQLError = { message: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLError[];
};

function getLensApiCandidates() {
  const envUrl = process.env.LENS_API_URL?.trim();
  const urls = [
    envUrl,
    "https://api.lens.xyz",
    "https://api.lens.xyz/graphql",
    "https://api-v2.lens.dev/",
    "https://api-v2.lens.dev/graphql",
    "https://api.lens.dev/graphql",
    "https://api.lens.dev/",
  ].filter((url): url is string => !!url);

  return Array.from(new Set(urls));
}

export async function lensRequest<TData = Record<string, unknown>, TVariables = Record<string, unknown>>(
  query: string,
  variables?: TVariables,
  accessToken?: string
): Promise<TData> {
  const appOrigin =
    process.env.LENS_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  const referer = appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`;

  const candidates = getLensApiCandidates();
  
  // Try primary endpoint first with shorter timeout, then fall back to others
  const primaryUrl = candidates[0];
  if (primaryUrl) {
    try {
      return await makeRequest<TData>(
        primaryUrl,
        query,
        variables,
        accessToken,
        appOrigin,
        referer,
        5000 // Shorter timeout for primary
      );
    } catch {
      // Fall through to parallel backup attempts
    }
  }

  // Try remaining endpoints in parallel with exponential backoff
  const backupUrls = candidates.slice(1);
  if (backupUrls.length === 0) {
    throw new Error(`Lens request failed: No endpoints available`);
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
        8000
      )
    )
  );

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  // All failed
  const failures = results.map((r) =>
    r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'unknown'
  );
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
  const response = await axios.post<GraphQLResponse<TData>>(
    url,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: appOrigin,
        Referer: referer,
        ...(accessToken && {
          Authorization: `Bearer ${accessToken}`,
        }),
      },
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
