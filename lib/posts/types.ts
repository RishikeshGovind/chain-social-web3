//lib/posts/types.ts

export type Username = {
  localName?: string;
};

export type Author = {
  address: string;
  username?: Username;
};

export type Post = {
  id: string;
  timestamp: string;
  metadata: {
    content: string;
    media?: string[]; // Array of media URLs (IPFS or local)
  };
  author: Author;
  likes: string[];
  reposts?: string[];
  replyCount?: number;
};

export type Reply = {
  id: string;
  postId: string;
  timestamp: string;
  metadata: {
    content: string;
  };
  author: Author;
};

export type Follow = {
  follower: string;
  following: string;
  createdAt: string;
};

export type Repost = {
  postId: string;
  address: string;
  createdAt: string;
};

export type ListPostsInput = {
  limit: number;
  cursor?: string;
  author?: string;
};

export type ListRepliesInput = {
  postId: string;
  limit: number;
  cursor?: string;
};
