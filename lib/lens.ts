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
  const failures: string[] = [];

  for (const lensApi of candidates) {
    try {
      const response = await axios.post<GraphQLResponse<TData>>(
        lensApi,
        {
          query,
          variables,
        },
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
          timeout: 12_000,
        }
      );

      const contentType = String(response.headers["content-type"] ?? "");
      const isJsonLike =
        contentType.includes("application/json") ||
        contentType.includes("application/graphql-response+json") ||
        contentType.includes("+json");
      if (!isJsonLike) {
        failures.push(`${lensApi}: non-JSON response (${contentType || "unknown content-type"})`);
        continue;
      }

      if (response.data.errors && response.data.errors.length > 0) {
        const message = response.data.errors[0]?.message ?? "Lens GraphQL request failed";
        failures.push(`${lensApi}: ${message}`);
        continue;
      }

      if (!response.data.data) {
        const preview = JSON.stringify(response.data).slice(0, 200);
        failures.push(`${lensApi}: missing data (${preview || "empty response"})`);
        continue;
      }

      return response.data.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown request error";
      failures.push(`${lensApi}: ${message}`);
    }
  }

  throw new Error(`Lens request failed across endpoints. ${failures.join(" | ")}`);
}
