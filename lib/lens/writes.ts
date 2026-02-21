//lib/lens/writes.ts

import { lensRequest } from "@/lib/lens";
import { normalizeAddress } from "@/lib/posts/content";
import type { Post, Reply } from "@/lib/posts/types";

type MutationVariant = {
  query: string;
  variables: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function extractFirstResult(data: unknown): Record<string, unknown> | null {
  const object = asObject(data);
  if (!object) return null;

  for (const value of Object.values(object)) {
    const result = asObject(value);
    if (result) return result;
  }

  return null;
}

async function executeVariants(variants: MutationVariant[], accessToken: string) {
  let lastError: Error | null = null;

  for (const variant of variants) {
    try {
      const result = await lensRequest<Record<string, unknown>, Record<string, unknown>>(
        variant.query,
        variant.variables,
        accessToken
      );
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Lens mutation failed");
    }
  }

  if (lastError) throw lastError;
  throw new Error("No Lens mutation variant succeeded");
}

export async function createLensPost(params: {
  content: string;
  actorAddress: string;
  accessToken: string;
}) {
  const data = await executeVariants(
    [
      {
        query: `
          mutation Post($request: CreatePostRequest!) {
            post(request: $request) {
              id
            }
          }
        `,
        variables: {
          request: {
            content: params.content,
          },
        },
      },
    ],
    params.accessToken
  );

  const result = extractFirstResult(data);
  const id = asString(result?.id) ?? `lens-${crypto.randomUUID()}`;

  const post: Post = {
    id,
    timestamp: new Date().toISOString(),
    metadata: { content: params.content },
    author: {
      address: normalizeAddress(params.actorAddress),
    },
    likes: [],
    replyCount: 0,
  };

  return post;
}

export async function createLensReply(params: {
  postId: string;
  content: string;
  actorAddress: string;
  accessToken: string;
}) {
  const data = await executeVariants(
    [
      {
        query: `
          mutation Comment($request: CreateCommentRequest!) {
            comment(request: $request) {
              id
            }
          }
        `,
        variables: {
          request: {
            publicationId: params.postId,
            content: params.content,
          },
        },
      },
      {
        query: `
          mutation Reply($request: CreateReplyRequest!) {
            reply(request: $request) {
              id
            }
          }
        `,
        variables: {
          request: {
            post: params.postId,
            content: params.content,
          },
        },
      },
    ],
    params.accessToken
  );

  const result = extractFirstResult(data);
  const id = asString(result?.id) ?? `lens-reply-${crypto.randomUUID()}`;

  const reply: Reply = {
    id,
    postId: params.postId,
    timestamp: new Date().toISOString(),
    metadata: { content: params.content },
    author: {
      address: normalizeAddress(params.actorAddress),
    },
  };

  return reply;
}

export async function toggleLensLike(params: {
  postId: string;
  currentlyLiked: boolean;
  accessToken: string;
}) {
  const reaction = "UPVOTE";

  await executeVariants(
    params.currentlyLiked
      ? [
          {
            query: `
              mutation RemoveReaction($request: RemoveReactionRequest!) {
                removeReaction(request: $request)
              }
            `,
            variables: {
              request: {
                for: params.postId,
                reaction,
              },
            },
          },
        ]
      : [
          {
            query: `
              mutation AddReaction($request: AddReactionRequest!) {
                addReaction(request: $request)
              }
            `,
            variables: {
              request: {
                for: params.postId,
                reaction,
              },
            },
          },
        ],
    params.accessToken
  );

  return { liked: !params.currentlyLiked };
}

export async function toggleLensFollow(params: {
  targetAddress: string;
  currentlyFollowing: boolean;
  accessToken: string;
}) {
  await executeVariants(
    params.currentlyFollowing
      ? [
          {
            query: `
              mutation Unfollow($request: UnfollowRequest!) {
                unfollow(request: $request)
              }
            `,
            variables: {
              request: {
                account: params.targetAddress,
              },
            },
          },
        ]
      : [
          {
            query: `
              mutation Follow($request: FollowRequest!) {
                follow(request: $request)
              }
            `,
            variables: {
              request: {
                account: params.targetAddress,
              },
            },
          },
          {
            query: `
              mutation FollowMany($request: FollowRequest!) {
                follow(request: $request)
              }
            `,
            variables: {
              request: {
                accounts: [params.targetAddress],
              },
            },
          },
        ],
    params.accessToken
  );

  return { isFollowing: !params.currentlyFollowing };
}

export async function editLensPost(params: {
  postId: string;
  content: string;
  accessToken: string;
}) {
  await executeVariants(
    [
      {
        query: `
          mutation EditPost($request: EditPostRequest!) {
            editPost(request: $request) {
              id
            }
          }
        `,
        variables: {
          request: {
            publicationId: params.postId,
            content: params.content,
          },
        },
      },
    ],
    params.accessToken
  );
}

export async function deleteLensPost(params: { postId: string; accessToken: string }) {
  await executeVariants(
    [
      {
        query: `
          mutation DeletePost($request: DeletePostRequest!) {
            deletePost(request: $request)
          }
        `,
        variables: {
          request: {
            publicationId: params.postId,
          },
        },
      },
    ],
    params.accessToken
  );
}
