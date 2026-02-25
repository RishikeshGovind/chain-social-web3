//lib/lens/feed.ts

import { lensRequest } from "../lens";
import { normalizeAddress } from "../posts/content";
import type { Post } from "../posts/types";

type LensFetchInput = {
  limit: number;
  cursor?: string;
  author?: string;
  debug?: boolean;
  accessToken?: string;
  postId?: string;
};

type LensFeedOutput = {
  posts: Post[];
  nextCursor: string | null;
  debugMetadata?: unknown[];
};
// cache may store either the raw text or a parsed JSON object
const metadataContentCache = new Map<string, unknown>();

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isLikelyUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("ipfs://");
}

function normalizeMetadataUri(uri: string): string {
  const value = uri.trim();
  if (!value) return "";
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

function deepFindText(value: unknown): string | null {
  const queue: unknown[] = [value];
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
    if (!current) continue;

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
    if (!object) continue;

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

function extractContent(metadata: unknown): string {
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      return (
        asString(parsed.content) ??
        asString(parsed.description) ??
        asString(parsed.text) ??
        deepFindText(parsed) ??
        ""
      );
    } catch {
      const raw = metadata.trim();
      return raw && !isLikelyUrl(raw) ? raw : "";
    }
  }

  const object = asObject(metadata);
  if (!object) {
    return deepFindText(metadata) ?? "";
  }

  const directContent = asString(object.content);
  if (directContent) return directContent;

  const description = asString(object.description);
  if (description) return description;

  const nested = asObject(object.mainContentFocus);
  if (nested) {
    const nestedContent = asString(nested.content);
    if (nestedContent) return nestedContent;
  }

  return deepFindText(object) ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractMetadataUri(metadata: unknown): string | null {
  if (typeof metadata === "string") {
    const trimmed = metadata.trim();
    return isLikelyUrl(trimmed) ? normalizeMetadataUri(trimmed) : null;
  }

  const object = asObject(metadata);
  if (!object) return null;

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
async function fetchMetadata(uri: string): Promise<unknown> {
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    metadataContentCache.set(uri, parsed);
    return parsed;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    metadataContentCache.set(uri, "");
    return "";
  }
}

// Extract media URLs from various possible structures in the Lens API response
function extractMediaFromMetadata(metadata: unknown): string[] {
  const urls: string[] = [];
  const obj = asObject(metadata);
  if (!obj) return urls;

  // Direct media array (common in Lens v2)
  const mediaArray = obj.media;
  if (Array.isArray(mediaArray)) {
    for (const item of mediaArray) {
      // Can be { url: string } or { item: string } or just string
      const url = typeof item === 'string' 
        ? item 
        : asString(asObject(item)?.url) ?? asString(asObject(item)?.item);
      if (url) urls.push(normalizeMetadataUri(url));
    }
  }

  // attachments array (Lens v3 format with MediaImage/MediaVideo)
  const attachments = obj.attachments;
  if (Array.isArray(attachments)) {
    for (const item of attachments) {
      const itemObj = asObject(item);
      // MediaImage and MediaVideo have 'item' field
      const url = asString(itemObj?.item) ?? asString(itemObj?.url) ?? asString(itemObj?.uri);
      if (url) urls.push(normalizeMetadataUri(url));
    }
  }

  // image field - can be string OR object with { item, raw } (Lens v3)
  const imageField = obj.image;
  if (typeof imageField === 'string') {
    urls.push(normalizeMetadataUri(imageField));
  } else if (asObject(imageField)) {
    const imageObj = asObject(imageField)!;
    const imgUrl = asString(imageObj.item) ?? asString(imageObj.raw) ?? asString(imageObj.url);
    if (imgUrl) urls.push(normalizeMetadataUri(imgUrl));
  }

  // video field - can be string OR object with { item, raw } (Lens v3)
  const videoField = obj.video;
  if (typeof videoField === 'string') {
    urls.push(normalizeMetadataUri(videoField));
  } else if (asObject(videoField)) {
    const videoObj = asObject(videoField)!;
    const vidUrl = asString(videoObj.item) ?? asString(videoObj.raw) ?? asString(videoObj.url);
    if (vidUrl) urls.push(normalizeMetadataUri(vidUrl));
  }

  // audio field (for AudioMetadata)
  const audioField = obj.audio;
  if (typeof audioField === 'string') {
    urls.push(normalizeMetadataUri(audioField));
  } else if (asObject(audioField)) {
    const audioObj = asObject(audioField)!;
    const audUrl = asString(audioObj.item) ?? asString(audioObj.raw) ?? asString(audioObj.url);
    if (audUrl) urls.push(normalizeMetadataUri(audUrl));
  }

  // asset field (some Lens formats)
  const asset = asObject(obj.asset);
  if (asset) {
    const assetUrl = asString(asset.url) ?? asString(asset.uri) ?? asString(asset.item);
    if (assetUrl) urls.push(normalizeMetadataUri(assetUrl));
    
    // nested image/video in asset
    const assetImage = asObject(asset.image);
    const assetVideo = asObject(asset.video);
    if (assetImage) {
      const imgUrl = asString(assetImage.item) ?? asString(assetImage.raw) ?? asString(assetImage.url);
      if (imgUrl) urls.push(normalizeMetadataUri(imgUrl));
    }
    if (assetVideo) {
      const vidUrl = asString(assetVideo.item) ?? asString(assetVideo.raw) ?? asString(assetVideo.url);
      if (vidUrl) urls.push(normalizeMetadataUri(vidUrl));
    }
  }

  // Remove duplicates and filter out empty strings
  return [...new Set(urls)].filter((u) => u.length > 0);
}

export async function mapNodeToPost(
  node: unknown,
  debug?: boolean
): Promise<{ post: Post; rawMetadata?: unknown } | null> {
  const object = asObject(node);
  if (!object) return null;

  const id = asString(object.id);
  if (!id) return null;

  const createdAt =
    asString(object.timestamp) ??
    asString(object.createdAt) ??
    new Date().toISOString();

  const authorObj = asObject(object.author);
  const address = asString(authorObj?.address);
  if (!address) return null;

  const usernameObj = asObject(authorObj?.username);
  const localName = asString(usernameObj?.localName);

  // Try inline metadata first (from GraphQL response), then fallback to URIs
  const inlineMetadata = asObject(object.metadata);
  const contentUri = asString(object.contentUri);
  const metadataUri = asString(object.metadataUri);
  
  let content = "";
  let mediaUrls: string[] = [];
  let metadataRaw: unknown;

  // Priority 1: Extract from inline metadata object (Lens v2 GraphQL response)
  if (inlineMetadata) {
    content = extractContent(inlineMetadata);
    mediaUrls = extractMediaFromMetadata(inlineMetadata);
  }

  // Priority 2: Fetch from contentUri if content is still empty
  if (!content && contentUri) {
    const normalized = normalizeMetadataUri(contentUri);
    metadataRaw = await fetchMetadata(normalized);
    content = extractContent(metadataRaw);
    if (!mediaUrls.length) {
      mediaUrls = extractMediaFromMetadata(metadataRaw);
    }
  }

  // Priority 3: Fetch from metadataUri if content is still empty
  if (!content && metadataUri) {
    const normalized = normalizeMetadataUri(metadataUri);
    metadataRaw = await fetchMetadata(normalized);
    content = extractContent(metadataRaw);
    if (!mediaUrls.length) {
      mediaUrls = extractMediaFromMetadata(metadataRaw);
    }
  }

  // Priority 4: Direct fields fallback
  if (!content) {
    const contentField = asString(object.content);
    const bodyField = asString(object.body);
    content = contentField || bodyField || "";
  }

  const statsObj = asObject(object.stats) ?? {};
  const repliesCount =
    Number(statsObj.comments ?? 0) || 0;

  const post: Post = {
    id,
    timestamp: createdAt,
    metadata: { content, ...(mediaUrls.length ? { media: mediaUrls } : {}) },
    author: {
      address: normalizeAddress(address),
      ...(localName ? { username: { localName } } : {}),
    },
    likes: [],
    replyCount: repliesCount,
  };

  return {
    post,
    ...(debug
      ? {
          rawMetadata: {
            typename: object.__typename ?? null,
            contentUri: object.contentUri ?? null,
            inlineMetadataTypename: inlineMetadata?.__typename ?? null,
            mediaCount: mediaUrls.length,
          },
        }
      : {}),
  };
}

async function extractPosts(
  data: unknown,
  debug?: boolean
): Promise<{ items: Post[]; nextCursor: string | null; debugMetadata?: unknown[] }> {
  const root = asObject(data);
  if (!root) return { items: [], nextCursor: null };

  const postsObj = asObject(root.posts);
  if (postsObj && Array.isArray(postsObj.items)) {
    const mapped = await Promise.all(postsObj.items.map((item) => mapNodeToPost(item, debug)));
    const valid = mapped.filter((item): item is { post: Post; rawMetadata?: unknown } => !!item);
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
    const mapped = await Promise.all(
      feedObj.items
        .map((feedItem) => asObject(feedItem))
        .map((feedItem) => mapNodeToPost(feedItem?.root ?? feedItem?.item ?? feedItem, debug))
    );
    const valid = mapped.filter((item): item is { post: Post; rawMetadata?: unknown } => !!item);
    const items = valid.map((item) => item.post);

    const nextCursor =
      asString(asObject(feedObj.pageInfo)?.next) ??
      asString(asObject(feedObj.pageInfo)?.nextCursor);

    return {
      items,
      nextCursor: nextCursor ?? null,
      ...(debug ? { debugMetadata: valid.map((item) => item.rawMetadata) } : {}),
    };
  }

  return { items: [], nextCursor: null };
}

// Lens v3 uses PageSize enum: TEN or FIFTY
function getPageSize(limit: number): string {
  return limit > 10 ? "FIFTY" : "TEN";
}

const QUERY_VARIANTS = [
  {
    // Most complete query - includes all media types and image/video assets
    query: `
      query Posts($request: PostsRequest!) {
        posts(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                __typename
                ... on TextOnlyMetadata {
                  content
                }
                ... on ArticleMetadata {
                  content
                  attachments {
                    ... on MediaImage {
                      item
                    }
                    ... on MediaVideo {
                      item
                    }
                  }
                }
                ... on ImageMetadata {
                  content
                  image {
                    item
                    raw
                  }
                  attachments {
                    ... on MediaImage {
                      item
                    }
                  }
                }
                ... on VideoMetadata {
                  content
                  video {
                    item
                    raw
                  }
                  attachments {
                    ... on MediaVideo {
                      item
                    }
                  }
                }
                ... on AudioMetadata {
                  content
                  audio {
                    item
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
    variables: (input: LensFetchInput) => ({
      request: {
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.author ? { filter: { authors: [input.author] } } : {}),
      },
    }),
  },
  {
    // Simplified media query with just media array
    query: `
      query Posts($request: PostsRequest!) {
        posts(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                __typename
                ... on TextOnlyMetadata {
                  content
                }
                ... on ArticleMetadata {
                  content
                }
                ... on ImageMetadata {
                  content
                  image {
                    item
                  }
                }
                ... on VideoMetadata {
                  content
                  video {
                    item
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
    variables: (input: LensFetchInput) => ({
      request: {
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.author ? { filter: { authors: [input.author] } } : {}),
      },
    }),
  },
  {
    // Text-only fallback
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
    variables: (input: LensFetchInput) => ({
      request: {
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.author ? { filter: { authors: [input.author] } } : {}),
      },
    }),
  },
  {
    // Minimal fallback
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
    variables: (input: LensFetchInput) => ({
      request: {
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.author ? { filter: { authors: [input.author] } } : {}),
      },
    }),
  },
];

export async function fetchLensPosts(input: LensFetchInput): Promise<LensFeedOutput> {
  const errors: string[] = [];
  const normalizedAuthor = input.author ? normalizeAddress(input.author) : null;

  for (const variant of QUERY_VARIANTS) {
    try {
      console.log("[Lens] Attempting query with variant...");
      const data = await lensRequest(variant.query, variant.variables(input), input.accessToken);
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Lens query failed";
      console.warn("[Lens] Query failed:", msg);
      errors.push(msg);
    }
  }

  console.error("[Lens] All query variants failed:", errors);
  throw new Error(errors.join(" | "));
}
