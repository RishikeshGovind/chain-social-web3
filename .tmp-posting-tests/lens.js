"use strict";
//lib/lens.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.lensRequest = lensRequest;
const axios_1 = require("axios");
function getLensApiCandidates() {
    // Lens v3 uses api.lens.xyz/graphql as the primary endpoint
    const envUrl = process.env.LENS_API_URL?.trim();
    // Ensure URL ends with /graphql
    const normalizeUrl = (url) => {
        if (!url || url.length === 0)
            return null;
        // Remove trailing slash
        url = url.replace(/\/$/, '');
        // Add /graphql if not present
        if (!url.endsWith('/graphql')) {
            url = `${url}/graphql`;
        }
        return url;
    };
    const normalized = normalizeUrl(envUrl);
    const defaultUrl = "https://api.lens.xyz/graphql";
    const urls = [];
    if (normalized)
        urls.push(normalized);
    if (!urls.includes(defaultUrl))
        urls.push(defaultUrl);
    console.log("[Lens] Using API endpoints:", urls);
    return urls;
}
async function lensRequest(query, variables, accessToken) {
    const appOrigin = process.env.LENS_ORIGIN?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        "http://localhost:3000";
    const referer = appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`;
    const candidates = getLensApiCandidates();
    if (candidates.length === 0) {
        throw new Error(`Lens request failed: No endpoints available`);
    }
    // Try primary endpoint first with shorter timeout, then fall back to others
    const primaryUrl = candidates[0];
    let primaryError = null;
    try {
        return await makeRequest(primaryUrl, query, variables, accessToken, appOrigin, referer, 8000);
    }
    catch (err) {
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
        hasAccessToken: !!accessToken,
    });
    const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: appOrigin,
        Referer: referer,
    };
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
        console.log("[Lens] Using Authorization header with token");
    }
    const response = await axios_1.default.post(url, { query, variables }, {
        headers,
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
