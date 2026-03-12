import type { Follow, Post, PostOutboxItem, Reply, Repost } from "@/lib/posts/types";

export type PersistedComplianceState = {
  dsarRequests: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
};

export type PersistedModerationReport = {
  id: string;
  reporterAddress: string;
  entityType: "post" | "reply" | "profile" | "message" | "media";
  entityId: string;
  targetAddress?: string;
  reason: string;
  details?: string;
  status: "open" | "reviewed" | "actioned" | "rejected";
  createdAt: string;
  updatedAt: string;
  resolutionNotes?: string;
  action?: string;
};

export type PersistedSafetyActivityRecord = {
  type:
    | "post"
    | "reply"
    | "message"
    | "upload"
    | "follow"
    | "profile_update"
    | "report_received"
    | "report_submitted"
    | "auto_action"
    | "threshold_action";
  timestamp: string;
  fingerprint?: string;
};

export type PersistedSafetyProfile = {
  address: string;
  trustScore: number;
  riskLevel: "low" | "medium" | "high";
  labels: string[];
  penalties: number;
  actionCounts: {
    posts: number;
    replies: number;
    messages: number;
    uploads: number;
    follows: number;
    reportsReceived: number;
    reportsSubmitted: number;
    autoActions: number;
    thresholdActions: number;
  };
  recentActivity: PersistedSafetyActivityRecord[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedMediaFingerprint = {
  actorAddress: string;
  sha256: string;
  url?: string;
  mimeType?: string;
  status: "clean" | "quarantined" | "blocked";
  labels: string[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedModerationState = {
  reports: PersistedModerationReport[];
  hiddenPostIds: string[];
  hiddenReplyIds: string[];
  hiddenProfileAddresses: string[];
  bannedAddresses: string[];
  blockedMediaUrls: string[];
  quarantinedMediaUrls: string[];
  approvedRemoteMediaUrls: string[];
  safetyProfiles: PersistedSafetyProfile[];
  mediaFingerprints: PersistedMediaFingerprint[];
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
  moderation?: PersistedModerationState;
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
    moderation: {
      reports: [],
      hiddenPostIds: [],
      hiddenReplyIds: [],
      hiddenProfileAddresses: [],
      bannedAddresses: [],
      blockedMediaUrls: [],
      quarantinedMediaUrls: [],
      approvedRemoteMediaUrls: [],
      safetyProfiles: [],
      mediaFingerprints: [],
    },
  };
}
