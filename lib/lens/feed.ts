//lib/lens/feed.ts

import { lensRequest } from "../lens";
import { normalizeAddress } from "../posts/content";
import type { Post, Reply } from "../posts/types";

type LensFetchInput = {
  limit: number;
  cursor?: string;
  author?: string;
  quick?: boolean;
  debug?: boolean;
  accessToken?: string;
  postId?: string;
};

type LensFeedOutput = {
  posts: Post[];
  nextCursor: string | null;
  debugMetadata?: unknown[];
};

type LensRepliesOutput = {
  replies: Reply[];
  nextCursor: string | null;
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
      const looksLikeMetadataType = /^[A-Za-z]+Metadata$/.test(trimmed);
      const looksLikeTypename = /^Media(Image|Video|Audio)$/.test(trimmed);
      if (trimmed && !isLikelyUrl(trimmed) && !looksLikeMetadataType && !looksLikeTypename) {
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

    for (const [key, nestedValue] of Object.entries(object)) {
      if (key === "__typename") continue;
      queue.push(nestedValue);
    }
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

  const withKind = (url: string, kind: "image" | "video" | "gif" = "image") => {
    const normalized = normalizeMetadataUri(url);
    if (!normalized) return;
    if (kind === "image") {
      urls.push(normalized);
      return;
    }
    const separator = normalized.includes("?") ? "&" : "?";
    urls.push(`${normalized}${separator}__media=${kind}`);
  };

  // Direct media array (common in Lens v2)
  const mediaArray = obj.media;
  if (Array.isArray(mediaArray)) {
    for (const item of mediaArray) {
      // Can be { url: string } or { item: string } or just string
      const url = typeof item === 'string' 
        ? item 
        : asString(asObject(item)?.url) ?? asString(asObject(item)?.item);
      const itemType = asString(asObject(item)?.type)?.toLowerCase() ?? "";
      if (url) {
        if (itemType.includes("video")) {
          withKind(url, "video");
        } else if (itemType.includes("gif")) {
          withKind(url, "gif");
        } else {
          withKind(url, "image");
        }
      }
    }
  }

  // attachments array (Lens v3 format with MediaImage/MediaVideo)
  const attachments = obj.attachments;
  if (Array.isArray(attachments)) {
    for (const item of attachments) {
      const itemObj = asObject(item);
      // MediaImage and MediaVideo have 'item' field
      const url = asString(itemObj?.item) ?? asString(itemObj?.url) ?? asString(itemObj?.uri);
      const typename = asString(itemObj?.__typename);
      const mediaType = asString(itemObj?.type)?.toLowerCase() ?? "";
      if (url) {
        if (typename === "MediaVideo" || mediaType.includes("video")) {
          withKind(url, "video");
        } else if (mediaType.includes("gif")) {
          withKind(url, "gif");
        } else {
          withKind(url, "image");
        }
      }
    }
  }

  // image field - can be string OR object with { item, raw } (Lens v3)
  const imageField = obj.image;
  if (typeof imageField === 'string') {
    withKind(imageField, "image");
  } else if (asObject(imageField)) {
    const imageObj = asObject(imageField)!;
    const imgUrl = asString(imageObj.item) ?? asString(imageObj.raw) ?? asString(imageObj.url);
    if (imgUrl) withKind(imgUrl, "image");
  }

  // video field - can be string OR object with { item, raw } (Lens v3)
  const videoField = obj.video;
  if (typeof videoField === 'string') {
    withKind(videoField, "video");
  } else if (asObject(videoField)) {
    const videoObj = asObject(videoField)!;
    const vidUrl = asString(videoObj.item) ?? asString(videoObj.raw) ?? asString(videoObj.url);
    if (vidUrl) withKind(vidUrl, "video");
  }

  // audio field (for AudioMetadata)
  const audioField = obj.audio;
  if (typeof audioField === 'string') {
    withKind(audioField, "video");
  } else if (asObject(audioField)) {
    const audioObj = asObject(audioField)!;
    const audUrl = asString(audioObj.item) ?? asString(audioObj.raw) ?? asString(audioObj.url);
    if (audUrl) withKind(audUrl, "video");
  }

  // asset field (some Lens formats)
  const asset = asObject(obj.asset);
  if (asset) {
    const assetUrl = asString(asset.url) ?? asString(asset.uri) ?? asString(asset.item);
    if (assetUrl) withKind(assetUrl, "image");
    
    // nested image/video in asset
    const assetImage = asObject(asset.image);
    const assetVideo = asObject(asset.video);
    if (assetImage) {
      const imgUrl = asString(assetImage.item) ?? asString(assetImage.raw) ?? asString(assetImage.url);
      if (imgUrl) withKind(imgUrl, "image");
    }
    if (assetVideo) {
      const vidUrl = asString(assetVideo.item) ?? asString(assetVideo.raw) ?? asString(assetVideo.url);
      if (vidUrl) withKind(vidUrl, "video");
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
    "1970-01-01T00:00:00.000Z";

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

async function mapNodeToReply(
  node: unknown,
  parentPostId: string
): Promise<Reply | null> {
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

  const inlineMetadata = asObject(object.metadata);
  const contentUri = asString(object.contentUri);
  const metadataUri = asString(object.metadataUri);

  let content = "";
  let metadataRaw: unknown;

  if (inlineMetadata) {
    content = extractContent(inlineMetadata);
  }

  if (!content && contentUri) {
    metadataRaw = await fetchMetadata(normalizeMetadataUri(contentUri));
    content = extractContent(metadataRaw);
  }

  if (!content && metadataUri) {
    metadataRaw = await fetchMetadata(normalizeMetadataUri(metadataUri));
    content = extractContent(metadataRaw);
  }

  if (!content) {
    content = asString(object.content) ?? asString(object.body) ?? "";
  }

  return {
    id,
    postId: parentPostId,
    timestamp: createdAt,
    metadata: { content },
    author: {
      address: normalizeAddress(address),
      ...(localName ? { username: { localName } } : {}),
    },
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
        .map(async (feedItem) => {
          const mappedPost = await mapNodeToPost(feedItem?.root ?? feedItem?.item ?? feedItem, debug);
          if (!mappedPost) return null;
          const feedTimestamp = asString(feedItem?.timestamp);
          if (feedTimestamp) {
            mappedPost.post.timestamp = feedTimestamp;
          }
          return mappedPost;
        })
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
      },
    }),
  },
];

const FEED_QUERY_VARIANTS = [
  {
    query: `
      query Feed($request: FeedRequest!) {
        feed(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                __typename
                ... on TextOnlyMetadata { content }
                ... on ArticleMetadata { content }
                ... on ImageMetadata { content image { item raw } }
                ... on VideoMetadata { content video { item raw } }
                ... on AudioMetadata { content audio { item } }
                ... on EmbedMetadata { content }
                ... on LinkMetadata { content }
              }
              author {
                address
                username { localName }
              }
              stats { comments }
            }
            ... on FeedItem {
              root {
                __typename
                ... on Post {
                  id
                  timestamp
                  metadata {
                    __typename
                    ... on TextOnlyMetadata { content }
                    ... on ArticleMetadata { content }
                    ... on ImageMetadata { content image { item raw } }
                    ... on VideoMetadata { content video { item raw } }
                    ... on AudioMetadata { content audio { item } }
                    ... on EmbedMetadata { content }
                    ... on LinkMetadata { content }
                  }
                  author {
                    address
                    username { localName }
                  }
                  stats { comments }
                }
              }
              item {
                __typename
                ... on Post {
                  id
                  timestamp
                  metadata {
                    __typename
                    ... on TextOnlyMetadata { content }
                    ... on ArticleMetadata { content }
                    ... on ImageMetadata { content image { item raw } }
                    ... on VideoMetadata { content video { item raw } }
                    ... on AudioMetadata { content audio { item } }
                    ... on EmbedMetadata { content }
                    ... on LinkMetadata { content }
                  }
                  author {
                    address
                    username { localName }
                  }
                  stats { comments }
                }
              }
              timestamp
            }
          }
          pageInfo { next }
        }
      }
    `,
    variables: (input: LensFetchInput) => ({
      request: {
        filter: "GLOBAL",
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    }),
  },
  {
    query: `
      query Feed($request: FeedRequest!) {
        feed(request: $request) {
          items {
            __typename
            ... on Post {
              id
              timestamp
              metadata {
                ... on TextOnlyMetadata { content }
              }
              author {
                address
                username { localName }
              }
              stats { comments }
            }
            ... on FeedItem {
              root {
                __typename
                ... on Post {
                  id
                  timestamp
                  metadata {
                    ... on TextOnlyMetadata { content }
                  }
                  author {
                    address
                    username { localName }
                  }
                  stats { comments }
                }
              }
              item {
                __typename
                ... on Post {
                  id
                  timestamp
                  metadata {
                    ... on TextOnlyMetadata { content }
                  }
                  author {
                    address
                    username { localName }
                  }
                  stats { comments }
                }
              }
              timestamp
            }
          }
          pageInfo { next }
        }
      }
    `,
    variables: () => ({
      request: {
        filter: "GLOBAL",
      },
    }),
  },
];

const AUTHOR_QUERY_VARIANTS = [
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
                __typename
                ... on TextOnlyMetadata { content }
                ... on ArticleMetadata { content }
                ... on ImageMetadata { content image { item raw } }
                ... on VideoMetadata { content video { item raw } }
                ... on AudioMetadata { content audio { item } }
                ... on EmbedMetadata { content }
                ... on LinkMetadata { content }
              }
              author {
                address
                username { localName }
              }
              stats { comments }
            }
          }
          pageInfo { next }
        }
      }
    `,
    variables: (input: LensFetchInput, author: string) => ({
      request: {
        filter: { authors: [author] },
        pageSize: getPageSize(input.limit || 50),
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
                __typename
                ... on TextOnlyMetadata { content }
                ... on ArticleMetadata { content }
                ... on ImageMetadata { content image { item raw } }
                ... on VideoMetadata { content video { item raw } }
                ... on AudioMetadata { content audio { item } }
                ... on EmbedMetadata { content }
                ... on LinkMetadata { content }
              }
              author {
                address
                username { localName }
              }
              stats { comments }
            }
          }
          pageInfo { next }
        }
      }
    `,
    variables: (input: LensFetchInput, author: string) => ({
      request: {
        authors: [author],
        pageSize: getPageSize(input.limit || 50),
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
                __typename
                ... on TextOnlyMetadata { content }
                ... on ArticleMetadata { content }
                ... on ImageMetadata { content image { item raw } }
                ... on VideoMetadata { content video { item raw } }
                ... on AudioMetadata { content audio { item } }
                ... on EmbedMetadata { content }
                ... on LinkMetadata { content }
              }
              author {
                address
                username { localName }
              }
              stats { comments }
            }
          }
          pageInfo { next }
        }
      }
    `,
    variables: (input: LensFetchInput, author: string) => ({
      request: {
        filter: { authors: [{ address: author }] },
        pageSize: getPageSize(input.limit || 50),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    }),
  },
];

export async function fetchLensPosts(input: LensFetchInput): Promise<LensFeedOutput> {
  const errors: string[] = [];
  const normalizedAuthor = input.author ? normalizeAddress(input.author) : null;
  const targetCount = Math.min(Math.max(input.limit || 20, 1), 200);
  const maxAuthorFallbackPages = input.quick ? 8 : 80;

  // Global timeline should come from feed() so repost-driven items can surface.
  // For author/post-specific fetches we keep posts() behavior.
  if (!input.author && !input.postId) {
    for (const variant of FEED_QUERY_VARIANTS) {
      try {
        const data = await lensRequest(variant.query, variant.variables(input), input.accessToken);
        const extracted = await extractPosts(data, input.debug);
        return {
          posts: extracted.items,
          nextCursor: extracted.nextCursor,
          ...(input.debug ? { debugMetadata: extracted.debugMetadata } : {}),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Lens feed query failed";
        errors.push(msg);
      }
    }
  }

  if (normalizedAuthor) {
    for (const variant of AUTHOR_QUERY_VARIANTS) {
      try {
        const data = await lensRequest(
          variant.query,
          variant.variables(input, normalizedAuthor),
          input.accessToken
        );
        const extracted = await extractPosts(data, input.debug);
        const filteredItems = extracted.items.filter(
          (post) => post.author.address === normalizedAuthor
        );
        if (filteredItems.length > 0 || extracted.nextCursor) {
          return {
            posts: filteredItems.slice(0, targetCount),
            nextCursor: extracted.nextCursor,
            ...(input.debug ? { debugMetadata: extracted.debugMetadata } : {}),
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Lens author query failed";
        errors.push(msg);
      }
    }
  }

  for (const variant of QUERY_VARIANTS) {
    try {
      console.log("[Lens] Attempting query with variant...");
      if (normalizedAuthor) {
        const collected: Post[] = [];
        const seenIds = new Set<string>();
        let cursor: string | undefined = input.cursor;
        let nextCursor: string | null = null;

        // Author filtering is client-side; page through the upstream feed so
        // older authored posts are still discoverable.
        for (let page = 0; page < maxAuthorFallbackPages; page += 1) {
          const data = await lensRequest(
            variant.query,
            variant.variables({ ...input, cursor }),
            input.accessToken
          );
          const extracted = await extractPosts(data, input.debug);
          const filtered = extracted.items.filter(
            (post) => post.author.address === normalizedAuthor
          );

          for (const post of filtered) {
            if (seenIds.has(post.id)) continue;
            seenIds.add(post.id);
            collected.push(post);
          }

          nextCursor = extracted.nextCursor;
          if (collected.length >= targetCount || !nextCursor) break;
          cursor = nextCursor;
        }

        return {
          posts: collected.slice(0, targetCount),
          nextCursor,
        };
      }

      const data = await lensRequest(variant.query, variant.variables(input), input.accessToken);
      console.log("[Lens] Query successful, extracting posts...", data);
      const extracted = await extractPosts(data, input.debug);
      console.log("[Lens] Extracted posts:", extracted.items.length, "items");
      return {
        // Lens PageSize is enum-based (TEN/FIFTY). When requesting limit=20,
        // the API page is often FIFTY; slicing to 20 while using the FIFTY cursor
        // skips 21-50 on the next page. Return the full page to avoid gaps.
        posts: extracted.items,
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

function buildPostReferencesQuery(referenceType: string, includePaging: boolean): string {
  return `
  query PostReferences($postId: PostId!${includePaging ? ", $cursor: Cursor, $pageSize: PageSize" : ""}) {
    postReferences(
      request: {
        referencedPost: $postId
        referenceTypes: [${referenceType}]
        ${includePaging ? "cursor: $cursor" : ""}
        ${includePaging ? "pageSize: $pageSize" : ""}
      }
    ) {
      items {
        __typename
        ... on Post {
          id
          timestamp
          metadata {
            __typename
            ... on TextOnlyMetadata { content }
            ... on ArticleMetadata { content }
            ... on ImageMetadata { content }
            ... on VideoMetadata { content }
            ... on AudioMetadata { content }
            ... on EmbedMetadata { content }
            ... on LinkMetadata { content }
          }
          author {
            address
            username { localName }
          }
        }
      }
      pageInfo { next }
    }
  }
`;
}

export async function fetchLensReplies(input: {
  postId: string;
  limit: number;
  cursor?: string;
  accessToken?: string;
}): Promise<LensRepliesOutput> {
  const postId = String(input.postId ?? "").trim();
  if (!postId) {
    throw new Error("Lens replies query failed: postId is missing");
  }

  const referenceTypeVariants = ["REPLY", "COMMENT_ON", "COMMENT_OF", "QUOTE_OF"];
  const queryVariants: Array<{ query: string; variables: Record<string, unknown> }> = [
    {
      query: buildPostReferencesQuery(referenceTypeVariants[0], true),
      variables: {
        postId,
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    },
    {
      query: buildPostReferencesQuery(referenceTypeVariants[0], false),
      variables: {
        postId,
      },
    },
  ];
  for (let i = 1; i < referenceTypeVariants.length; i += 1) {
    queryVariants.push({
      query: buildPostReferencesQuery(referenceTypeVariants[i], true),
      variables: {
        postId,
        pageSize: getPageSize(input.limit || 20),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    });
    queryVariants.push({
      query: buildPostReferencesQuery(referenceTypeVariants[i], false),
      variables: { postId },
    });
  }

  const errors: string[] = [];
  for (const variant of queryVariants) {
    try {
      const data = await lensRequest(variant.query, variant.variables, input.accessToken);
      const root = asObject(data);
      const referencesObj = asObject(root?.postReferences);
      const rawItems: unknown[] = Array.isArray(referencesObj?.items)
        ? referencesObj!.items
        : [];

      const mapped = await Promise.all(
        rawItems.map((item) => mapNodeToReply(item, input.postId))
      );
      const replies = mapped.filter((item): item is Reply => !!item);
      const nextCursor =
        asString(asObject(referencesObj?.pageInfo)?.next) ??
        null;

      return {
        replies: replies.slice(0, Math.max(1, input.limit)),
        nextCursor,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Lens replies query failed");
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
  return { replies: [], nextCursor: null };
}
