//lib/posts/store.ts

import { normalizeAddress } from "@/lib/posts/content";
import { canMutateOwnedResource, canToggleFollow } from "@/lib/posts/authz";
import type {
  Follow,
  ListPostsInput,
  ListRepliesInput,
  Post,
  PostOutboxItem,
  PostOutboxStatus,
  Reply,
  Repost,
} from "@/lib/posts/types";
import { mergeState, readState } from "@/lib/server/persistence";
import { randomUUID } from "node:crypto";

type StoreData = {
  posts: Post[];
  replies: Reply[];
  follows: Follow[];
  reposts: Repost[];
  postOutbox: PostOutboxItem[];
};

const DEFAULT_POSTS: Post[] = [
  {
    id: "1",
    timestamp: new Date().toISOString(),
    metadata: { content: "Hello, world! This is a demo post." },
    author: {
      username: { localName: "alice" },
      address: "0x1234567890abcdef1234567890abcdef12345678",
    },
    likes: [],
    reposts: [],
  },
  {
    id: "2",
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    metadata: { content: "Welcome to your new social feed!" },
    author: {
      username: { localName: "bob" },
      address: "0xfedcba0987654321fedcba0987654321fedcba09",
    },
    likes: [],
    reposts: [],
  },
];

let cachedStore: StoreData | null = null;
let writeChain = Promise.resolve();

function encodeCursor(item: { timestamp: string; id: string }) {
  return Buffer.from(JSON.stringify({ timestamp: item.timestamp, id: item.id })).toString(
    "base64url"
  );
}

function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { timestamp?: string; id?: string };
    if (!parsed.timestamp || !parsed.id) return null;
    return { timestamp: parsed.timestamp, id: parsed.id };
  } catch {
    return null;
  }
}

function compareDesc(a: { timestamp: string; id: string }, b: { timestamp: string; id: string }) {
  if (a.timestamp === b.timestamp) {
    return b.id.localeCompare(a.id);
  }
  return b.timestamp.localeCompare(a.timestamp);
}

function withReplyCounts(posts: Post[], replies: Reply[]) {
  // Use Map for O(1) lookups instead of object
  const counts = new Map<string, number>();
  for (const reply of replies) {
    counts.set(reply.postId, (counts.get(reply.postId) ?? 0) + 1);
  }

  return posts.map((post) => ({
    ...post,
    replyCount: counts.get(post.id) ?? 0,
  }));
}

function withRepostCounts(posts: Post[], reposts: Repost[]) {
  const repostMap = new Map<string, Set<string>>();
  for (const repost of reposts) {
    const set = repostMap.get(repost.postId) ?? new Set<string>();
    set.add(repost.address);
    repostMap.set(repost.postId, set);
  }

  return posts.map((post) => ({
    ...post,
    reposts: Array.from(repostMap.get(post.id) ?? []),
  }));
}

async function persist(store: StoreData) {
  await mergeState(store);
}

async function loadStore(): Promise<StoreData> {
  if (cachedStore) return cachedStore;

  const parsed = (await readState()) as Partial<StoreData> | null;
  if (!parsed) {
    cachedStore = { posts: DEFAULT_POSTS, replies: [], follows: [], reposts: [], postOutbox: [] };
    await persist(cachedStore);
  } else {
    cachedStore = {
      posts: Array.isArray(parsed.posts) ? parsed.posts : DEFAULT_POSTS,
      replies: Array.isArray(parsed.replies) ? parsed.replies : [],
      follows: Array.isArray(parsed.follows) ? parsed.follows : [],
      reposts: Array.isArray(parsed.reposts) ? parsed.reposts : [],
      postOutbox: Array.isArray(parsed.postOutbox) ? parsed.postOutbox : [],
    };
  }

  cachedStore.posts = cachedStore.posts
    .map((post) => ({
      ...post,
      author: {
        ...post.author,
        address: normalizeAddress(post.author.address),
      },
      likes: (post.likes ?? []).map((address) => normalizeAddress(address)),
      reposts: (post.reposts ?? []).map((address) => normalizeAddress(address)),
    }))
    .sort(compareDesc);

  cachedStore.replies = cachedStore.replies
    .map((reply) => ({
      ...reply,
      author: {
        ...reply.author,
        address: normalizeAddress(reply.author.address),
      },
    }))
    .sort(compareDesc);

  cachedStore.follows = cachedStore.follows.map((follow) => ({
    ...follow,
    follower: normalizeAddress(follow.follower),
    following: normalizeAddress(follow.following),
  }));

  cachedStore.reposts = cachedStore.reposts.map((repost) => ({
    ...repost,
    address: normalizeAddress(repost.address),
  }));

  cachedStore.postOutbox = cachedStore.postOutbox
    .map((item) => ({
      ...item,
      address: normalizeAddress(item.address),
      status: item.status ?? "pending",
      attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return cachedStore;
}

async function saveStore(store: StoreData) {
  writeChain = writeChain.then(() => persist(store));
  await writeChain;
}

export async function listPosts({ limit, cursor, author }: ListPostsInput) {
  const store = await loadStore();
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  const normalizedAuthor = author ? normalizeAddress(author) : undefined;

  let posts = store.posts;
  if (normalizedAuthor) {
    posts = posts.filter((post) => post.author.address === normalizedAuthor);
  }

  const decodedCursor = decodeCursor(cursor);
  if (decodedCursor) {
    const cursorIndex = posts.findIndex(
      (post) => post.id === decodedCursor.id && post.timestamp === decodedCursor.timestamp
    );
    if (cursorIndex >= 0) {
      posts = posts.slice(cursorIndex + 1);
    }
  }

  const itemsWithReplies = withReplyCounts(posts.slice(0, boundedLimit), store.replies);
  const items = withRepostCounts(itemsWithReplies, store.reposts);
  const nextCursor =
    items.length === boundedLimit ? encodeCursor({
      id: items[items.length - 1].id,
      timestamp: items[items.length - 1].timestamp,
    }) : null;

  return { posts: items, nextCursor };
}

export async function getPostById(postId: string) {
  const store = await loadStore();
  const post = store.posts.find((item) => item.id === postId);
  if (!post) return null;

  return {
    ...post,
    replyCount: store.replies.filter((reply) => reply.postId === post.id).length,
    reposts: withRepostCounts([post], store.reposts)[0]?.reposts ?? [],
  };
}

export async function createPost(params: {
  id?: string;
  timestamp?: string;
  address: string;
  content: string;
  username?: string;
  media?: string[];
  chainPostId?: string;
  publishStatus?: "published" | "pending" | "failed" | "local_only";
}) {
  const store = await loadStore();
  const inferredPublishStatus =
    params.publishStatus ??
    (params.id && /^0x[a-f0-9]{64}$/i.test(params.id) ? "published" : "local_only");
  const chainPostId =
    params.chainPostId ??
    (inferredPublishStatus === "published" && params.id ? params.id : undefined);

  const post: Post = {
    id: params.id ?? randomUUID(),
    timestamp: params.timestamp ?? new Date().toISOString(),
    ...(chainPostId ? { chainPostId } : {}),
    publishStatus: inferredPublishStatus,
    indexedAt: new Date().toISOString(),
    metadata: {
      content: params.content,
      ...(params.media ? { media: params.media } : {}),
    },
    author: {
      address: normalizeAddress(params.address),
      ...(params.username ? { username: { localName: params.username.slice(0, 32) } } : {}),
    },
    likes: [],
    reposts: [],
  };

  const existingIndex = store.posts.findIndex((item) => item.id === post.id);
  if (existingIndex >= 0) {
    store.posts[existingIndex] = post;
  } else {
    store.posts.unshift(post);
  }
  store.posts.sort(compareDesc);
  await saveStore(store);
  return { ...post, replyCount: 0 };
}

function isChainPostId(value: string) {
  return /^0x[a-f0-9]{64}$/i.test(value);
}

function isLegacyLocalPost(post: Post) {
  if (post.publishStatus === "published") return false;
  return !isChainPostId(post.id);
}

export async function listLegacyLocalPosts(params?: { address?: string; limit?: number }) {
  const store = await loadStore();
  const normalizedAddress = params?.address ? normalizeAddress(params.address) : undefined;
  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 500);
  const items = store.posts
    .filter((post) => (normalizedAddress ? post.author.address === normalizedAddress : true))
    .filter((post) => isLegacyLocalPost(post))
    .sort(compareDesc)
    .slice(0, limit);
  return items;
}

export async function listPostOutbox(params?: { address?: string; statuses?: PostOutboxStatus[] }) {
  const store = await loadStore();
  const normalizedAddress = params?.address ? normalizeAddress(params.address) : undefined;
  const statuses = params?.statuses ? new Set(params.statuses) : null;
  return store.postOutbox.filter((item) => {
    if (normalizedAddress && item.address !== normalizedAddress) return false;
    if (statuses && !statuses.has(item.status)) return false;
    return true;
  });
}

export async function enqueueLegacyPostsForMigration(params: { address: string; limit?: number }) {
  const store = await loadStore();
  const address = normalizeAddress(params.address);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const candidates = store.posts
    .filter((post) => post.author.address === address && isLegacyLocalPost(post))
    .sort(compareDesc)
    .slice(0, limit);

  let enqueued = 0;
  for (const post of candidates) {
    const exists = store.postOutbox.find(
      (item) => item.postId === post.id && item.address === address && item.status !== "published"
    );
    if (exists) continue;
    const now = new Date().toISOString();
    store.postOutbox.unshift({
      id: randomUUID(),
      postId: post.id,
      address,
      content: post.metadata.content,
      media: post.metadata.media,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    enqueued += 1;
  }

  if (enqueued > 0) {
    await saveStore(store);
  }

  return {
    scanned: candidates.length,
    enqueued,
  };
}

export async function markPostOutboxProcessing(outboxId: string) {
  const store = await loadStore();
  const item = store.postOutbox.find((entry) => entry.id === outboxId);
  if (!item) return null;
  item.status = "processing";
  item.updatedAt = new Date().toISOString();
  await saveStore(store);
  return item;
}

export async function markPostOutboxFailed(outboxId: string, error: string) {
  const store = await loadStore();
  const item = store.postOutbox.find((entry) => entry.id === outboxId);
  if (!item) return null;
  item.status = "failed";
  item.attempts += 1;
  item.lastError = error.slice(0, 500);
  item.updatedAt = new Date().toISOString();
  await saveStore(store);
  return item;
}

export async function markPostOutboxPublished(outboxId: string, chainPostId: string) {
  const store = await loadStore();
  const item = store.postOutbox.find((entry) => entry.id === outboxId);
  if (!item) return null;

  item.status = "published";
  item.attempts += 1;
  item.chainPostId = chainPostId;
  item.publishedAt = new Date().toISOString();
  item.updatedAt = item.publishedAt;

  const post = store.posts.find((entry) => entry.id === item.postId);
  if (post) {
    post.publishStatus = "published";
    post.chainPostId = chainPostId;
    post.indexedAt = new Date().toISOString();
  }

  await saveStore(store);
  return item;
}

export async function toggleLike(postId: string, actorAddress: string) {
  const store = await loadStore();
  const post = store.posts.find((item) => item.id === postId);

  if (!post) return null;

  const address = normalizeAddress(actorAddress);
  const index = post.likes.indexOf(address);
  const liked = index === -1;

  if (liked) {
    post.likes.push(address);
  } else {
    post.likes.splice(index, 1);
  }

  await saveStore(store);
  return {
    post: {
      ...post,
      replyCount: store.replies.filter((reply) => reply.postId === post.id).length,
      reposts: withRepostCounts([post], store.reposts)[0]?.reposts ?? [],
    },
    liked,
    likes: post.likes.length,
  };
}

export async function toggleRepost(postId: string, actorAddress: string) {
  const store = await loadStore();
  const address = normalizeAddress(actorAddress);

  const existingIndex = store.reposts.findIndex(
    (item) => item.postId === postId && item.address === address
  );

  let reposted = false;
  if (existingIndex >= 0) {
    store.reposts.splice(existingIndex, 1);
    reposted = false;
  } else {
    store.reposts.push({
      postId,
      address,
      createdAt: new Date().toISOString(),
    });
    reposted = true;
  }

  await saveStore(store);

  const post = store.posts.find((item) => item.id === postId);
  const reposts = store.reposts
    .filter((item) => item.postId === postId)
    .map((item) => item.address);

  return {
    post: post
      ? {
          ...post,
          replyCount: store.replies.filter((reply) => reply.postId === post.id).length,
          reposts,
        }
      : null,
    reposted,
    reposts: reposts.length,
  };
}

export async function getRepostRecord(postId: string, actorAddress: string) {
  const store = await loadStore();
  const address = normalizeAddress(actorAddress);
  return (
    store.reposts.find((item) => item.postId === postId && item.address === address) ?? null
  );
}

export async function toggleRepostWithPublicationId(
  postId: string,
  actorAddress: string,
  publicationId?: string
) {
  const store = await loadStore();
  const address = normalizeAddress(actorAddress);

  const existingIndex = store.reposts.findIndex(
    (item) => item.postId === postId && item.address === address
  );

  let reposted = false;
  if (existingIndex >= 0) {
    store.reposts.splice(existingIndex, 1);
    reposted = false;
  } else {
    store.reposts.push({
      postId,
      address,
      createdAt: new Date().toISOString(),
      ...(publicationId ? { publicationId } : {}),
    });
    reposted = true;
  }

  await saveStore(store);

  const post = store.posts.find((item) => item.id === postId);
  const reposts = store.reposts
    .filter((item) => item.postId === postId)
    .map((item) => item.address);

  return {
    post: post
      ? {
          ...post,
          replyCount: store.replies.filter((reply) => reply.postId === post.id).length,
          reposts,
        }
      : null,
    reposted,
    reposts: reposts.length,
  };
}

export async function getRepostsForPosts(postIds: string[]) {
  const store = await loadStore();
  const result = new Map<string, string[]>();
  const idSet = new Set(postIds);
  for (const repost of store.reposts) {
    if (!idSet.has(repost.postId)) continue;
    const current = result.get(repost.postId) ?? [];
    if (!current.includes(repost.address)) {
      current.push(repost.address);
    }
    result.set(repost.postId, current);
  }
  return result;
}

export async function editPost(postId: string, actorAddress: string, content: string) {
  const store = await loadStore();
  const post = store.posts.find((item) => item.id === postId);

  if (!post) return { type: "not_found" as const };
  if (!canMutateOwnedResource(actorAddress, post.author.address)) {
    return { type: "forbidden" as const };
  }

  post.metadata.content = content;
  await saveStore(store);
  return {
    type: "ok" as const,
    post: {
      ...post,
      replyCount: store.replies.filter((reply) => reply.postId === post.id).length,
    },
  };
}

export async function deletePost(postId: string, actorAddress: string) {
  const store = await loadStore();
  const index = store.posts.findIndex((item) => item.id === postId);

  if (index === -1) return { type: "not_found" as const };
  if (!canMutateOwnedResource(actorAddress, store.posts[index].author.address)) {
    return { type: "forbidden" as const };
  }

  store.posts.splice(index, 1);
  store.replies = store.replies.filter((reply) => reply.postId !== postId);
  await saveStore(store);
  return { type: "ok" as const };
}

export async function listReplies({ postId, limit, cursor }: ListRepliesInput) {
  const store = await loadStore();
  const boundedLimit = Math.min(Math.max(limit, 1), 50);

  let replies = store.replies.filter((reply) => reply.postId === postId);

  const decodedCursor = decodeCursor(cursor);
  if (decodedCursor) {
    const cursorIndex = replies.findIndex(
      (reply) => reply.id === decodedCursor.id && reply.timestamp === decodedCursor.timestamp
    );
    if (cursorIndex >= 0) {
      replies = replies.slice(cursorIndex + 1);
    }
  }

  const items = replies.slice(0, boundedLimit);
  const nextCursor =
    items.length === boundedLimit ? encodeCursor(items[items.length - 1]) : null;

  return { replies: items, nextCursor };
}

export async function createReply(params: {
  postId: string;
  address: string;
  content: string;
  username?: string;
}) {
  const store = await loadStore();

  const reply: Reply = {
    id: randomUUID(),
    postId: params.postId,
    timestamp: new Date().toISOString(),
    metadata: { content: params.content },
    author: {
      address: normalizeAddress(params.address),
      ...(params.username ? { username: { localName: params.username.slice(0, 32) } } : {}),
    },
  };

  store.replies.unshift(reply);
  await saveStore(store);

  return {
    type: "ok" as const,
    reply,
    replyCount: store.replies.filter((item) => item.postId === params.postId).length,
  };
}

export async function upsertReply(params: {
  id: string;
  postId: string;
  address: string;
  content: string;
  username?: string;
  timestamp?: string;
}) {
  const store = await loadStore();
  const normalizedAddress = normalizeAddress(params.address);
  const ts = params.timestamp ?? new Date().toISOString();

  const existingIndex = store.replies.findIndex((item) => item.id === params.id);
  const reply: Reply = {
    id: params.id,
    postId: params.postId,
    timestamp: ts,
    metadata: { content: params.content },
    author: {
      address: normalizedAddress,
      ...(params.username ? { username: { localName: params.username.slice(0, 32) } } : {}),
    },
  };

  if (existingIndex >= 0) {
    store.replies[existingIndex] = reply;
  } else {
    store.replies.unshift(reply);
  }
  store.replies.sort(compareDesc);
  await saveStore(store);

  return {
    type: "ok" as const,
    reply,
    replyCount: store.replies.filter((item) => item.postId === params.postId).length,
  };
}

export async function toggleFollow(params: { follower: string; following: string }) {
  const store = await loadStore();
  const follower = normalizeAddress(params.follower);
  const following = normalizeAddress(params.following);

  if (!canToggleFollow(follower, following)) {
    return { type: "invalid" as const, message: "You cannot follow yourself" };
  }

  const existingIndex = store.follows.findIndex(
    (item) => item.follower === follower && item.following === following
  );

  let isFollowing = false;
  if (existingIndex >= 0) {
    store.follows.splice(existingIndex, 1);
    isFollowing = false;
  } else {
    store.follows.push({
      follower,
      following,
      createdAt: new Date().toISOString(),
    });
    isFollowing = true;
  }

  await saveStore(store);
  const followers = store.follows.filter((item) => item.following === following).length;
  const followingCount = store.follows.filter((item) => item.follower === following).length;

  return {
    type: "ok" as const,
    isFollowing,
    followers,
    following: followingCount,
  };
}

export async function getFollowStats(targetAddress: string, viewerAddress?: string) {
  const store = await loadStore();
  const target = normalizeAddress(targetAddress);
  const viewer = viewerAddress ? normalizeAddress(viewerAddress) : undefined;

  const followers = store.follows.filter((item) => item.following === target).length;
  const following = store.follows.filter((item) => item.follower === target).length;
  const isFollowing = viewer
    ? store.follows.some((item) => item.follower === viewer && item.following === target)
    : false;

  return {
    followers,
    following,
    isFollowing,
  };
}

export async function exportUserOffchainData(address: string) {
  const store = await loadStore();
  const normalized = normalizeAddress(address);
  return {
    posts: store.posts.filter((post) => post.author.address === normalized),
    replies: store.replies.filter((reply) => reply.author.address === normalized),
    followsAsFollower: store.follows.filter((follow) => follow.follower === normalized),
    followsAsFollowing: store.follows.filter((follow) => follow.following === normalized),
    reposts: store.reposts.filter((repost) => repost.address === normalized),
    postOutbox: store.postOutbox.filter((item) => item.address === normalized),
    likedPostIds: store.posts
      .filter((post) => (post.likes ?? []).includes(normalized))
      .map((post) => post.id),
  };
}

export async function deleteUserOffchainData(address: string) {
  const store = await loadStore();
  const normalized = normalizeAddress(address);

  const before = {
    posts: store.posts.length,
    replies: store.replies.length,
    follows: store.follows.length,
    reposts: store.reposts.length,
    postOutbox: store.postOutbox.length,
  };

  store.posts = store.posts.filter((post) => post.author.address !== normalized);
  store.replies = store.replies.filter((reply) => reply.author.address !== normalized);
  store.follows = store.follows.filter(
    (follow) => follow.follower !== normalized && follow.following !== normalized
  );
  store.reposts = store.reposts.filter((repost) => repost.address !== normalized);
  store.postOutbox = store.postOutbox.filter((item) => item.address !== normalized);

  for (const post of store.posts) {
    post.likes = (post.likes ?? []).filter((likeAddress) => likeAddress !== normalized);
    post.reposts = (post.reposts ?? []).filter((repostAddress) => repostAddress !== normalized);
  }

  await saveStore(store);

  return {
    deletedPosts: before.posts - store.posts.length,
    deletedReplies: before.replies - store.replies.length,
    deletedFollows: before.follows - store.follows.length,
    deletedReposts: before.reposts - store.reposts.length,
    deletedPostOutbox: before.postOutbox - store.postOutbox.length,
  };
}
