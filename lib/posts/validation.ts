// lib/posts/validation.ts

/**
 * Sanitize/validate an array of media URLs coming from the client.
 *
 * - only allows http(s) URLs
 * - enforces a maximum of 4 items
 * - accepts traditional image extensions as well as IPFS gateway links
 *   (`/ipfs/<hash>`) which do not necessarily include an extension.
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
  // require http(s) protocol – anything else is immediately invalid
  for (const url of urls) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, error: "Only image URLs are allowed." };
    }
  }

  const filtered = urls; // already guaranteed http(s)

  if (filtered.length > 4) {
    return { ok: false, error: "Max 4 images per post." };
  }

  for (const url of filtered) {
    const cleaned = url.split("?")[0];
    if (
      !/\.(jpg|jpeg|png|gif|webp)$/i.test(cleaned) &&
      !cleaned.includes("/ipfs/")
    ) {
      return { ok: false, error: "Only image URLs are allowed." };
    }
  }

  return { ok: true, urls: filtered };
}
