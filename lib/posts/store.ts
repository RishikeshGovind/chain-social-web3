import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeAddress } from "@/lib/posts/content";
import { canMutateOwnedResource, canToggleFollow } from "@/lib/posts/authz";
import type { Follow, ListPostsInput, ListRepliesInput, Post, Reply } from "@/lib/posts/types";

type StoreData = {
  posts: Post[];
  replies: Reply[];
  follows: Follow[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

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
  const counts = replies.reduce<Record<string, number>>((acc, reply) => {
    acc[reply.postId] = (acc[reply.postId] ?? 0) + 1;
    return acc;
  }, {});

  return posts.map((post) => ({
    ...post,
    replyCount: counts[post.id] ?? 0,
  }));
}

async function persist(store: StoreData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(POSTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function loadStore(): Promise<StoreData> {
  if (cachedStore) return cachedStore;

  try {
    const raw = await readFile(POSTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    cachedStore = {
      posts: Array.isArray(parsed.posts) ? parsed.posts : DEFAULT_POSTS,
      replies: Array.isArray(parsed.replies) ? parsed.replies : [],
      follows: Array.isArray(parsed.follows) ? parsed.follows : [],
    };
  } catch {
    cachedStore = { posts: DEFAULT_POSTS, replies: [], follows: [] };
    await persist(cachedStore);
  }

  cachedStore.posts = cachedStore.posts
    .map((post) => ({
      ...post,
      author: {
        ...post.author,
        address: normalizeAddress(post.author.address),
      },
      likes: (post.likes ?? []).map((address) => normalizeAddress(address)),
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

  const items = withReplyCounts(posts.slice(0, boundedLimit), store.replies);
  const nextCursor =
    items.length === boundedLimit ? encodeCursor({
      id: items[items.length - 1].id,
      timestamp: items[items.length - 1].timestamp,
    }) : null;

  return { posts: items, nextCursor };
}

export async function createPost(params: {
  address: string;
  content: string;
  username?: string;
}) {
  const store = await loadStore();

  const post: Post = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { content: params.content },
    author: {
      address: normalizeAddress(params.address),
      ...(params.username ? { username: { localName: params.username.slice(0, 32) } } : {}),
    },
    likes: [],
  };

  store.posts.unshift(post);
  await saveStore(store);
  return { ...post, replyCount: 0 };
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
    },
    liked,
    likes: post.likes.length,
  };
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
  const parentPost = store.posts.find((post) => post.id === params.postId);

  if (!parentPost) {
    return { type: "not_found" as const };
  }

  const reply: Reply = {
    id: crypto.randomUUID(),
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
