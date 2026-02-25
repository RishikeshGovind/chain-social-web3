"use strict";
//lib/lens/feed.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapNodeToPost = mapNodeToPost;
exports.fetchLensPosts = fetchLensPosts;
const lens_1 = require("../lens");
const content_1 = require("../posts/content");
// cache may store either the raw text or a parsed JSON object
const metadataContentCache = new Map();
function asObject(value) {
    return value && typeof value === "object" ? value : null;
}
function asString(value) {
    return typeof value === "string" ? value : null;
}
function isLikelyUrl(value) {
    return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("ipfs://");
}
function normalizeMetadataUri(uri) {
    const value = uri.trim();
    if (!value)
        return "";
    if (value.startsWith("ipfs://")) {
        const path = value.replace("ipfs://", "");
        return `https://ipfs.io/ipfs/${path}`;
    }
    if (value.startsWith("ar://")) {
        const path = value.replace("ar://", "");
        return `https://arweave.net/${path}`;
    }
    return value;
}
function deepFindText(value) {
    const queue = [value];
    const keyPriority = [
        "content",
        "text",
        "body",
        "description",
        "markdown",
        "caption",
        "title",
    ];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
            continue;
        if (typeof current === "string") {
            const trimmed = current.trim();
            if (trimmed && !isLikelyUrl(trimmed)) {
                return trimmed;
            }
            continue;
        }
        if (Array.isArray(current)) {
            queue.push(...current);
            continue;
        }
        const object = asObject(current);
        if (!object)
            continue;
        for (const key of keyPriority) {
            const direct = asString(object[key]);
            if (direct && direct.trim() && !isLikelyUrl(direct.trim())) {
                return direct.trim();
            }
        }
        queue.push(...Object.values(object));
    }
    return null;
}
function extractContent(metadata) {
    if (typeof metadata === "string") {
        try {
            const parsed = JSON.parse(metadata);
            return (asString(parsed.content) ??
                asString(parsed.description) ??
                asString(parsed.text) ??
                deepFindText(parsed) ??
                "");
        }
        catch {
            const raw = metadata.trim();
            return raw && !isLikelyUrl(raw) ? raw : "";
        }
    }
    const object = asObject(metadata);
    if (!object) {
        return deepFindText(metadata) ?? "";
    }
    const directContent = asString(object.content);
    if (directContent)
        return directContent;
    const description = asString(object.description);
    if (description)
        return description;
    const nested = asObject(object.mainContentFocus);
    if (nested) {
        const nestedContent = asString(nested.content);
        if (nestedContent)
            return nestedContent;
    }
    return deepFindText(object) ?? "";
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractMetadataUri(metadata) {
    if (typeof metadata === "string") {
        const trimmed = metadata.trim();
        return isLikelyUrl(trimmed) ? normalizeMetadataUri(trimmed) : null;
    }
    const object = asObject(metadata);
    if (!object)
        return null;
    const keys = ["uri", "metadataUri", "contentUri", "rawURI", "rawUri"];
    for (const key of keys) {
        const value = asString(object[key]);
        if (value && isLikelyUrl(value)) {
            return normalizeMetadataUri(value);
        }
    }
    return null;
}
// return both the raw metadata and a pre-extracted text content so
// callers can pull out richer information such as media URLs.  the cache now
// stores whatever object was returned from the URI.
async function fetchMetadata(uri) {
    if (metadataContentCache.has(uri)) {
        return metadataContentCache.get(uri);
    }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(uri, {
            method: "GET",
            headers: { Accept: "application/json,text/plain" },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
            metadataContentCache.set(uri, "");
            return "";
        }
        const text = await res.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = text;
        }
        metadataContentCache.set(uri, parsed);
        return parsed;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    }
    catch (_error) {
        metadataContentCache.set(uri, "");
        return "";
    }
}
async function mapNodeToPost(node, debug) {
    const object = asObject(node);
    if (!object)
        return null;
    const id = asString(object.id);
    if (!id)
        return null;
    const createdAt = asString(object.timestamp) ??
        asString(object.createdAt) ??
        new Date().toISOString();
    const authorObj = asObject(object.author);
    const address = asString(authorObj?.address);
    if (!address)
        return null;
    const usernameObj = asObject(authorObj?.username);
    const localName = asString(usernameObj?.localName);
    // Try contentUri, then metadataUri, then direct fields
    const contentUri = asString(object.contentUri);
    const metadataUri = asString(object.metadataUri);
    let content = "";
    let mediaUrls = [];
    let metadataRaw;
    if (contentUri) {
        const normalized = normalizeMetadataUri(contentUri);
        metadataRaw = await fetchMetadata(normalized);
        content = extractContent(metadataRaw);
    }
    else if (metadataUri) {
        const normalized = normalizeMetadataUri(metadataUri);
        metadataRaw = await fetchMetadata(normalized);
        content = extractContent(metadataRaw);
    }
    else {
        // Fallback to direct fields if URIs are missing
        const contentField = asString(object.content);
        const bodyField = asString(object.body);
        const metadataField = extractContent(object.metadata);
        content = contentField || bodyField || metadataField || "";
    }
    // attempt to pull out any media urls from the raw metadata JSON
    if (!mediaUrls.length && metadataRaw) {
        if (typeof metadataRaw === 'object' && metadataRaw !== null) {
            const obj = metadataRaw;
            const maybeMedia = obj.media;
            if (Array.isArray(maybeMedia)) {
                mediaUrls = maybeMedia
                    .map((m) => (typeof m === 'string' ? m : asString(m.url)))
                    .filter((u) => !!u);
            }
        }
    }
    const statsObj = asObject(object.stats) ?? {};
    const repliesCount = Number(statsObj.comments ?? 0) || 0;
    const post = {
        id,
        timestamp: createdAt,
        metadata: { content, ...(mediaUrls.length ? { media: mediaUrls } : {}) },
        author: {
            address: (0, content_1.normalizeAddress)(address),
            ...(localName ? { username: { localName } } : {}),
        },
        likes: [],
        replyCount: repliesCount,
    };
    // ...existing code...
    return {
        post,
        ...(debug
            ? {
                rawMetadata: {
                    typename: object.__typename ?? null,
                    contentUri: object.contentUri ?? null,
                },
            }
            : {}),
    };
}
async function extractPosts(data, debug) {
    const root = asObject(data);
    if (!root)
        return { items: [], nextCursor: null };
    const postsObj = asObject(root.posts);
    if (postsObj && Array.isArray(postsObj.items)) {
        const mapped = await Promise.all(postsObj.items.map((item) => mapNodeToPost(item, debug)));
        const valid = mapped.filter((item) => !!item);
        const items = valid.map((item) => item.post);
        const nextCursor = asString(asObject(postsObj.pageInfo)?.next);
        return {
            items,
            nextCursor: nextCursor ?? null,
            ...(debug ? { debugMetadata: valid.map((item) => item.rawMetadata) } : {}),
        };
    }
    const feedObj = asObject(root.feed);
    if (feedObj && Array.isArray(feedObj.items)) {
        const mapped = await Promise.all(feedObj.items
            .map((feedItem) => asObject(feedItem))
            .map((feedItem) => mapNodeToPost(feedItem?.root ?? feedItem?.item ?? feedItem, debug)));
        const valid = mapped.filter((item) => !!item);
        const items = valid.map((item) => item.post);
        const nextCursor = asString(asObject(feedObj.pageInfo)?.next) ??
            asString(asObject(feedObj.pageInfo)?.nextCursor);
        return {
            items,
            nextCursor: nextCursor ?? null,
            ...(debug ? { debugMetadata: valid.map((item) => item.rawMetadata) } : {}),
        };
    }
    return { items: [], nextCursor: null };
}
const QUERY_VARIANTS = [
    {
        query: `
      query Posts($request: PostsRequest!) {
        posts(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                ... on TextOnlyMetadata {
                  content
                }
                ... on ArticleMetadata {
                  content
                }
                ... on ImageMetadata {
                  content
                  media {
                    url
                  }
                }
                ... on VideoMetadata {
                  content
                  media {
                    url
                  }
                }
                ... on EmbedMetadata {
                  content
                }
                ... on LinkMetadata {
                  content
                }
              }
              author {
                address
                username {
                  localName
                }
              }
              stats {
                comments
              }
            }
          }
          pageInfo {
            next
          }
        }
      }
    `,
        variables: (input) => ({
            request: {
                ...(input.cursor ? { cursor: input.cursor } : {}),
            },
        }),
    },
    {
        query: `
      query Posts($request: PostsRequest!) {
        posts(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                ... on TextOnlyMetadata {
                  content
                }
              }
              author {
                address
                username {
                  localName
                }
              }
              stats {
                comments
              }
            }
          }
          pageInfo {
            next
          }
        }
      }
    `,
        variables: (input) => ({
            request: {
                ...(input.cursor ? { cursor: input.cursor } : {}),
            },
        }),
    },
    {
        query: `
      query Posts($request: PostsRequest!) {
        posts(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              author {
                address
                username {
                  localName
                }
              }
              stats {
                comments
              }
            }
          }
          pageInfo {
            next
          }
        }
      }
    `,
        variables: (input) => ({
            request: {
                ...(input.cursor ? { cursor: input.cursor } : {}),
            },
        }),
    },
];
async function fetchLensPosts(input) {
    const errors = [];
    const normalizedAuthor = input.author ? (0, content_1.normalizeAddress)(input.author) : null;
    for (const variant of QUERY_VARIANTS) {
        try {
            console.log("[Lens] Attempting query with variant...");
            const data = await (0, lens_1.lensRequest)(variant.query, variant.variables(input), input.accessToken);
            console.log("[Lens] Query successful, extracting posts...", data);
            const extracted = await extractPosts(data, input.debug);
            console.log("[Lens] Extracted posts:", extracted.items.length, "items");
            const filteredItems = normalizedAuthor
                ? extracted.items.filter((post) => post.author.address === normalizedAuthor)
                : extracted.items;
            return {
                posts: filteredItems.slice(0, Math.max(1, input.limit)),
                nextCursor: extracted.nextCursor,
                ...(input.debug ? { debugMetadata: extracted.debugMetadata } : {}),
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Lens query failed";
            console.warn("[Lens] Query failed:", msg);
            errors.push(msg);
        }
    }
    console.error("[Lens] All query variants failed:", errors);
    throw new Error(errors.join(" | "));
}
