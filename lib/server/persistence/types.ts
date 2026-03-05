import type { Follow, Post, PostOutboxItem, Reply, Repost } from "@/lib/posts/types";

export type ChainSocialState = {
  posts: Post[];
  replies: Reply[];
  follows: Follow[];
  reposts: Repost[];
  postOutbox: PostOutboxItem[];
};

export interface StateStore {
  read(): Promise<ChainSocialState | null>;
  write(state: ChainSocialState): Promise<void>;
}
