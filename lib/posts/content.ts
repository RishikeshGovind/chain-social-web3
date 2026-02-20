export const MAX_POST_LENGTH = 280;

export function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

export function isValidAddress(address: string) {
  return /^0x[a-f0-9]{40}$/i.test(address);
}

export function sanitizePostContent(content: string) {
  const withoutTags = content.replace(/<[^>]*>/g, "");
  const normalizedLines = withoutTags
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();

  return normalizedLines;
}

export function parseAndValidateContent(raw: unknown) {
  if (typeof raw !== "string") {
    return { ok: false as const, error: "Content must be a string" };
  }

  const content = sanitizePostContent(raw);
  if (!content) {
    return { ok: false as const, error: "Post content cannot be empty" };
  }

  if (content.length > MAX_POST_LENGTH) {
    return {
      ok: false as const,
      error: `Post exceeds ${MAX_POST_LENGTH} characters`,
    };
  }

  return { ok: true as const, content };
}
