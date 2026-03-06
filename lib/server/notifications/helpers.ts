import { normalizeAddress } from "@/lib/posts/content";
import { getPostById } from "@/lib/posts/store";
import { fetchLensPostById } from "@/lib/lens/feed";
import { createNotification } from "./store";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function actorLabel(address: string) {
  return shortenAddress(normalizeAddress(address));
}

async function resolvePostRecipient(postId: string, accessToken?: string) {
  const localPost = await getPostById(postId);
  if (localPost?.author?.address) {
    return {
      recipientAddress: localPost.author.address,
      entityHref: `/feed?post=${postId}`,
    };
  }

  const lensPost = await fetchLensPostById({ postId, accessToken });
  if (lensPost?.author?.address) {
    return {
      recipientAddress: lensPost.author.address,
      entityHref: `/feed?post=${postId}`,
    };
  }

  return null;
}

export async function notifyPostLiked(input: {
  postId: string;
  actorAddress: string;
  accessToken?: string;
}) {
  const recipient = await resolvePostRecipient(input.postId, input.accessToken);
  if (!recipient) return null;

  return createNotification({
    type: "like",
    recipientAddress: recipient.recipientAddress,
    actorAddress: input.actorAddress,
    message: `${actorLabel(input.actorAddress)} liked your post.`,
    entityId: input.postId,
    entityHref: recipient.entityHref,
    metadata: { postId: input.postId },
  });
}

export async function notifyPostReplied(input: {
  postId: string;
  replyId: string;
  actorAddress: string;
  accessToken?: string;
}) {
  const recipient = await resolvePostRecipient(input.postId, input.accessToken);
  if (!recipient) return null;

  return createNotification({
    type: "reply",
    recipientAddress: recipient.recipientAddress,
    actorAddress: input.actorAddress,
    message: `${actorLabel(input.actorAddress)} replied to your post.`,
    entityId: input.replyId,
    entityHref: recipient.entityHref,
    metadata: { postId: input.postId, replyId: input.replyId },
  });
}

export async function notifyPostReposted(input: {
  postId: string;
  actorAddress: string;
  accessToken?: string;
}) {
  const recipient = await resolvePostRecipient(input.postId, input.accessToken);
  if (!recipient) return null;

  return createNotification({
    type: "repost",
    recipientAddress: recipient.recipientAddress,
    actorAddress: input.actorAddress,
    message: `${actorLabel(input.actorAddress)} reposted your post.`,
    entityId: input.postId,
    entityHref: recipient.entityHref,
    metadata: { postId: input.postId },
  });
}

export async function notifyFollowed(input: {
  targetAddress: string;
  actorAddress: string;
}) {
  return createNotification({
    type: "follow",
    recipientAddress: input.targetAddress,
    actorAddress: input.actorAddress,
    message: `${actorLabel(input.actorAddress)} followed you.`,
    entityId: normalizeAddress(input.targetAddress),
    entityHref: `/profile/${normalizeAddress(input.actorAddress)}`,
    metadata: { profileAddress: normalizeAddress(input.targetAddress) },
  });
}
