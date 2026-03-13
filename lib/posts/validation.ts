// lib/posts/validation.ts

/**
 * Allowlisted media origin prefixes.
 *
 * Posts should only reference media that came through the controlled upload
 * pipeline (local `/uploads/` or the configured remote storage) or from
 * explicitly trusted IPFS gateways. Arbitrary external URLs are rejected so
 * that off-platform illegal images, tracking pixels, or CSAM links cannot be
 * embedded simply by posting a remote URL.
 */
function getAllowedMediaOrigins(): string[] {
  const origins: string[] = ["/uploads/"];

  // When a remote media backend is used, trust its origin.
  const remoteUrl = process.env.CHAINSOCIAL_MEDIA_REMOTE_URL?.trim();
  if (remoteUrl) {
    try {
      const u = new URL(remoteUrl);
      origins.push(u.origin + "/");
    } catch {
      // ignore malformed env value
    }
  }

  // Allow additional trusted origins via env (comma-separated).
  const extra = process.env.CHAINSOCIAL_MEDIA_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const raw of extra.split(",")) {
      const trimmed = raw.trim();
      if (trimmed) origins.push(trimmed);
    }
  }

  return origins;
}

/**
 * Trusted IPFS gateway hostnames. Only these hosts are allowed to serve
 * `/ipfs/` content — a bare path check would let any attacker host
 * `https://evil.example/ipfs/payload.jpg` and bypass the allowlist.
 */
const DEFAULT_IPFS_GATEWAYS = [
  "ipfs.io",
  "gateway.pinata.cloud",
  "cloudflare-ipfs.com",
  "w3s.link",
  "dweb.link",
  "nftstorage.link",
];

function getTrustedIpfsGateways(): string[] {
  const extra = process.env.CHAINSOCIAL_IPFS_GATEWAYS?.trim();
  if (!extra) return DEFAULT_IPFS_GATEWAYS;
  return [
    ...DEFAULT_IPFS_GATEWAYS,
    ...extra.split(",").map((h) => h.trim()).filter(Boolean),
  ];
}

function isAllowedMediaUrl(url: string): boolean {
  // Relative path from our own upload flow
  if (url.startsWith("/uploads/")) return true;
  // Relative path from the new private serve route
  if (url.startsWith("/api/media/serve/")) return true;

  // IPFS gateway links — only from trusted gateways
  if (url.includes("/ipfs/")) {
    try {
      const parsed = new URL(url);
      const gateways = getTrustedIpfsGateways();
      return gateways.some(
        (gw) => parsed.hostname === gw || parsed.hostname.endsWith(`.${gw}`)
      );
    } catch {
      return false;
    }
  }

  const origins = getAllowedMediaOrigins();
  return origins.some((origin) => url.startsWith(origin));
}

/**
 * Sanitize/validate an array of media URLs coming from the client.
 *
 * - only allows http(s) URLs or relative /uploads/ paths
 * - enforces a maximum of 4 items
 * - rejects URLs that do not come from the controlled upload flow or
 *   an explicitly trusted origin
 *
 * Returns a cleaned list (filtered to strings and http(s) urls) or an
 * error message.
 */
export function validateMediaUrls(raw: unknown):
  | { ok: true; urls: string[] }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: true, urls: [] };
  }

  const urls = raw.filter((u) => typeof u === "string");
  // require http(s) protocol or relative paths from our upload flows
  for (const url of urls) {
    if (
      !url.startsWith("http://") &&
      !url.startsWith("https://") &&
      !url.startsWith("/uploads/") &&
      !url.startsWith("/api/media/serve/")
    ) {
      return { ok: false, error: "Only image URLs are allowed." };
    }
  }

  const filtered = urls;

  if (filtered.length > 4) {
    return { ok: false, error: "Max 4 images per post." };
  }

  for (const url of filtered) {
    if (!isAllowedMediaUrl(url)) {
      return {
        ok: false,
        error:
          "External image URLs are not allowed. Please upload media through the app.",
      };
    }

    const cleaned = url.split("?")[0];
    if (
      !/\.(jpg|jpeg|png|gif|webp)$/i.test(cleaned) &&
      !cleaned.includes("/ipfs/") &&
      !cleaned.startsWith("/uploads/") &&
      !cleaned.startsWith("/api/media/serve/")
    ) {
      return { ok: false, error: "Only image URLs are allowed." };
    }
  }

  return { ok: true, urls: filtered };
}
