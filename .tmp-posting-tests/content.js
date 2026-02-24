"use strict";
//lib/posts/content.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_POST_LENGTH = void 0;
exports.normalizeAddress = normalizeAddress;
exports.isValidAddress = isValidAddress;
exports.sanitizePostContent = sanitizePostContent;
exports.parseAndValidateContent = parseAndValidateContent;
exports.MAX_POST_LENGTH = 280;
function normalizeAddress(address) {
    return address.trim().toLowerCase();
}
function isValidAddress(address) {
    return /^0x[a-f0-9]{40}$/i.test(address);
}
function sanitizePostContent(content) {
    const withoutTags = content.replace(/<[^>]*>/g, "");
    const normalizedLines = withoutTags
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .trim();
    return normalizedLines;
}
function parseAndValidateContent(raw) {
    if (typeof raw !== "string") {
        return { ok: false, error: "Content must be a string" };
    }
    const content = sanitizePostContent(raw);
    if (!content) {
        return { ok: false, error: "Post content cannot be empty" };
    }
    if (content.length > exports.MAX_POST_LENGTH) {
        return {
            ok: false,
            error: `Post exceeds ${exports.MAX_POST_LENGTH} characters`,
        };
    }
    return { ok: true, content };
}
