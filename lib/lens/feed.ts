import { lensRequest } from "@/lib/lens";
import { normalizeAddress } from "@/lib/posts/content";
import type { Post } from "@/lib/posts/types";

type LensFetchInput = {
  limit: number;
  cursor?: string;
  author?: string;
  debug?: boolean;
  accessToken?: string;
};

type LensFeedOutput = {
  posts: Post[];
  nextCursor: string | null;
  debugMetadata?: unknown[];
};
const metadataContentCache = new Map<string, string>();

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

function readContent(metadata: unknown): string {
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

async function fetchMetadataContent(uri: string): Promise<string> {
  if (metadataContentCache.has(uri)) {
    return metadataContentCache.get(uri) ?? "";
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
    const content = readContent(text);
    metadataContentCache.set(uri, content);
    return content;
  } catch {
    metadataContentCache.set(uri, "");
    return "";
  }
}

async function mapNodeToPost(
  node: unknown,
  debug?: boolean
): Promise<{ post: Post; rawMetadata?: unknown } | null> {
  const object = asObject(node);
  if (!object) return null;

  const id = asString(object.id) ?? asString(object.slug);
  if (!id) return null;

  const createdAt = asString(object.timestamp) ?? asString(object.createdAt) ?? new Date().toISOString();

  const authorObj = asObject(object.author) ?? asObject(object.by);
  const address =
    asString(authorObj?.address) ??
    asString(asObject(authorObj?.ownedBy)?.address) ??
    asString(authorObj?.ownedBy) ??
    "";

  if (!address) return null;

  const usernameObj = asObject(authorObj?.username);
  const localName = asString(usernameObj?.localName) ?? asString(authorObj?.handle) ?? undefined;

  let content =
    asString(object.content) ??
    asString(object.body) ??
    asString(object.description) ??
    readContent(object.metadata);
  if (!content) {
    const metadataUri =
      extractMetadataUri(object.metadata) ??
      extractMetadataUri(object.metadataUri) ??
      extractMetadataUri(object.contentUri);
    if (metadataUri) {
      content = await fetchMetadataContent(metadataUri);
    }
  }

  const statsObj = asObject(object.stats) ?? {};
  const likesCount =
    Number(statsObj.upvotes ?? statsObj.reactions ?? statsObj.likes ?? statsObj.collects ?? 0) || 0;
  const repliesCount =
    Number(statsObj.comments ?? statsObj.replies ?? statsObj.replyCount ?? 0) || 0;

  const post: Post = {
    id,
    timestamp: createdAt,
    metadata: { content },
    author: {
      address: normalizeAddress(address),
      ...(localName ? { username: { localName } } : {}),
    },
    likes: Array.from({ length: Math.max(0, likesCount) }, () => ""),
    replyCount: Math.max(0, repliesCount),
  };

  return {
    post,
    ...(debug
      ? {
          rawMetadata: {
            typename: object.__typename ?? null,
            metadata: object.metadata ?? null,
            metadataUri: object.metadataUri ?? null,
            contentUri: object.contentUri ?? null,
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
              content
              body
              metadata
              metadataUri
              contentUri
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
              metadata
              metadataUri
              contentUri
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
              metadata
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
    variables: (input: LensFetchInput) => ({
      request: {
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    }),
  },
];

export async function fetchLensPosts(input: LensFetchInput): Promise<LensFeedOutput> {
  const errors: string[] = [];
  const normalizedAuthor = input.author ? normalizeAddress(input.author) : null;

  for (const variant of QUERY_VARIANTS) {
    try {
      const data = await lensRequest(variant.query, variant.variables(input), input.accessToken);
      const extracted = await extractPosts(data, input.debug);
      const filteredItems = normalizedAuthor
        ? extracted.items.filter((post) => post.author.address === normalizedAuthor)
        : extracted.items;
      return {
        posts: filteredItems.slice(0, Math.max(1, input.limit)),
        nextCursor: extracted.nextCursor,
        ...(input.debug ? { debugMetadata: extracted.debugMetadata } : {}),
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Lens query failed");
    }
  }

  throw new Error(errors.join(" | "));
}
