import type { Follow, Post, PostOutboxItem, Reply, Repost } from "@/lib/posts/types";

export type PersistedComplianceState = {
  dsarRequests: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
};

export type PersistedNotificationRecord = {
  id: string;
  type: string;
  recipientAddress: string;
  actorAddress: string;
  message: string;
  createdAt: string;
  readAt?: string;
  entityId?: string;
  entityHref?: string;
  metadata?: Record<string, unknown>;
};

export type PersistedDirectMessageRecord = {
  id: string;
  senderAddress: string;
  recipientAddress: string;
  content: string;
  createdAt: string;
  readAt?: string;
};

export type PersistedBookmarkRecord = {
  id: string;
  ownerAddress: string;
  postId: string;
  createdAt: string;
};

export type PersistedUserListRecord = {
  id: string;
  ownerAddress: string;
  name: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedUserSettingsRecord = {
  ownerAddress: string;
  compactFeed: boolean;
  autoplayVideos: boolean;
  hideMediaPreviews: boolean;
  updatedAt: string;
};

export type ChainSocialState = {
  posts: Post[];
  replies: Reply[];
  follows: Follow[];
  reposts: Repost[];
  postOutbox: PostOutboxItem[];
  notifications?: PersistedNotificationRecord[];
  directMessages?: PersistedDirectMessageRecord[];
  bookmarks?: PersistedBookmarkRecord[];
  userLists?: PersistedUserListRecord[];
  userSettings?: PersistedUserSettingsRecord[];
  compliance?: PersistedComplianceState;
};

export interface StateStore {
  read(): Promise<ChainSocialState | null>;
  write(state: ChainSocialState): Promise<void>;
}

export function createEmptyState(): ChainSocialState {
  return {
    posts: [],
    replies: [],
    follows: [],
    reposts: [],
    postOutbox: [],
    notifications: [],
    directMessages: [],
    bookmarks: [],
    userLists: [],
    userSettings: [],
  };
}
