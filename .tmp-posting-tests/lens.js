"use strict";
//lib/lens.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.lensRequest = lensRequest;
const axios_1 = require("axios");
function getLensApiCandidates() {
    // the Lens network exposes a few slightly different URLs; historically
    // we tried nearly everything, but some of the root endpoints simply reply
    // with 405 when hit with POST.  keeping only the known good GraphQL paths
    // cuts down on noise and speeds up retries.
    const envUrl = process.env.LENS_API_URL?.trim();
    const urls = [
        envUrl,
        "https://api.lens.xyz/graphql",
        "https://api.lens.xyz",
        "https://api-v2.lens.dev/graphql",
        "https://api.lens.dev/graphql",
    ].filter((url) => !!url);
    return Array.from(new Set(urls));
}
async function lensRequest(query, variables, accessToken) {
    const appOrigin = process.env.LENS_ORIGIN?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        "http://localhost:3000";
    const referer = appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`;
    const candidates = getLensApiCandidates();
    // Try primary endpoint first with shorter timeout, then fall back to others
    const primaryUrl = candidates[0];
    if (primaryUrl) {
        try {
            return await makeRequest(primaryUrl, query, variables, accessToken, appOrigin, referer, 5000 // Shorter timeout for primary
            );
        }
        catch (err) {
            // if the error clearly indicates the account is still onboarding we
            // propagate it immediately rather than continuing to hit other hosts.
            if (err instanceof Error && err.message.includes("ONBOARDING_USER")) {
                throw err;
            }
            // otherwise fall through to parallel backup attempts
        }
    }
    // Try remaining endpoints in parallel with exponential backoff
    const backupUrls = candidates.slice(1);
    if (backupUrls.length === 0) {
        throw new Error(`Lens request failed: No endpoints available`);
    }
    const results = await Promise.allSettled(backupUrls.map((url) => makeRequest(url, query, variables, accessToken, appOrigin, referer, 8000)));
    // Return first successful result
    for (const result of results) {
        if (result.status === 'fulfilled') {
            return result.value;
        }
    }
    // All failed – inspect for onboarding-specific message first
    const failures = results.map((r) => r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'unknown');
    const onboarding = failures.find((m) => m.includes("ONBOARDING_USER"));
    if (onboarding) {
        throw new Error(onboarding);
    }
    throw new Error(`Lens request failed across all endpoints: ${failures.join(' | ')}`);
}
async function makeRequest(url, query, variables, accessToken, appOrigin, referer, timeout) {
    // debug output to help track schema mismatches at each endpoint
    console.log("[Lens] POST", url, {
        query: query.replace(/\s+/g, " ").trim(),
        variables,
    });
    const response = await axios_1.default.post(url, { query, variables }, {
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
    });
    const contentType = String(response.headers["content-type"] ?? "");
    const isJsonLike = contentType.includes("application/json") ||
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
