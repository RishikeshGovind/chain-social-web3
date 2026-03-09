//lib/lens/writes.ts

import { lensRequest } from "../lens";
import { normalizeAddress } from "../posts/content";
import type { Post, Reply } from "../posts/types";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/server/logger";

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

function getGraphQLTypename(value: unknown): string | null {
  const object = asObject(value);
  const typename = asString(object?.__typename);
  return typename ?? null;
}

export function extractFirstResult(data: unknown): Record<string, unknown> | null {
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

// Lens expects a URI for publication metadata. To avoid external upload
// requirements in local/dev usage, we inline a compact JSON document into a
// data URI. Keep this payload intentionally small to reduce URI parser issues.
export function buildContentUri(content: string, media?: string[]): string {
  const metadata: Record<string, unknown> = {
    version: "3.0.0",
    mainContentFocus: "TEXT_ONLY",
    content,
    id: randomUUID(),
    locale: "en",
  };

  if (media && media.length > 0) {
    metadata.mainContentFocus = "IMAGE";
    metadata.image = { item: media[0] };
    metadata.attachments = media.map((url) => ({ item: url }));
  }

  const json = JSON.stringify(metadata);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

/**
 * Construct the object that will be sent to the Lens API.
 *
 * This is a separate exported function so that tests can assert its shape
 * without having to actually perform any network activity.
 */
// NOTE: Lens v3 derives the acting account from the access token.
// The post payload only needs `contentUri` for this code path.
export function buildPostRequest(
  _actorAddress: string,
  content: string,
  media?: string[]
): Record<string, unknown> {
  const contentUri = buildContentUri(content, media);
  const requestBody: Record<string, unknown> = {
    contentUri,
  };

  // there are additional optional fields (quoteOf, commentOn, rules, etc.)
  // that we don't currently use; they can be added on demand here.
  return requestBody;
}

// thrown when a user tries to post but the Lens account is still in
// onboarding state (no minted profile).  We surface this specifically so
// callers can display a helpful message rather than silently falling back.
export class LensOnboardingError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "LensOnboardingError";
  }
}

// expose a low‑level switch mutation; callers can use this to refresh the
// authenticated account context after a profile has been minted.
export async function switchLensAccount(
  account: string,
  accessToken: string
): Promise<void> {
  try {
    await lensRequest(
      `mutation Switch($request: SwitchAccountRequest!) {
         switchAccount(request: $request)
       }`,
      { request: { account } },
      accessToken
    );
  } catch {
    // ignore failures; best‑effort
  }
}

// testing helpers
let _testOnboardInvocations = 0;

// allow tests to reset counter so repeated runs behave predictably
export function __setTestOnboardInvocations(n: number) {
  _testOnboardInvocations = n;
}

// helper used in tests to simulate the API rejecting the first
// request with an onboarding error and succeeding thereafter.
function maybeSimulateOnboarding(content: string) {
  if (content === "__TEST_ONBOARD_ERROR__") {
    _testOnboardInvocations += 1;
    if (_testOnboardInvocations === 1) {
      throw new LensOnboardingError(
        "Forbidden - You cannot access 'post' as 'ONBOARDING_USER'"
      );
    }
  }
}

export async function createLensPost(params: {
  content: string;
  actorAddress: string;
  accessToken: string;
  media?: string[];
}) {
  try {
    // Build the request body - author is derived from the access token
    const requestBody = buildPostRequest(
      params.actorAddress,
      params.content,
      params.media
    );
    // Avoid logging full data URI payloads (large + user content); log shape only.
    logger.debug("lens.create_post.request", {
      hasContentUri: typeof requestBody.contentUri === "string",
      contentUriLength:
        typeof requestBody.contentUri === "string" ? requestBody.contentUri.length : 0,
      hasMedia: !!params.media?.length,
    });
    logger.debug("lens.create_post.actor", { actorAddress: params.actorAddress });

    // simulate before making network call (tests only)
    maybeSimulateOnboarding(params.content);

    // CreatePostRequest on Lens v3 must not include "author".
    // The actor account is inferred from the bearer token context.
    const data = await executeVariants(
      [
        // Variant 1: post with contentUri only
        {
          query: `
            mutation Post($request: CreatePostRequest!) {
              post(request: $request) {
                ... on PostResponse { hash }
                ... on SelfFundedTransactionRequest { reason }
                ... on SponsoredTransactionRequest { reason }
                ... on TransactionWillFail { reason }
              }
            }
          `,
          variables: {
            request: {
              contentUri: requestBody.contentUri,
            },
          },
        },
      ],
      params.accessToken
    );

    const result = extractFirstResult(data);
    logger.debug("lens.create_post.result", {
      typename: getGraphQLTypename(result),
      hasHash: !!asString(result?.hash),
      hasReason: !!asString(result?.reason),
    });
    
    const typename = getGraphQLTypename(result);
    const reason = asString(result?.reason);
    const hash = asString(result?.hash); // PostResponse

    // Only treat finalized PostResponse as success.
    // Returning synthetic IDs here creates phantom posts that disappear later.
    if (!hash) {
      if (
        typename === "SponsoredTransactionRequest" ||
        typename === "SelfFundedTransactionRequest" ||
        typename === "TransactionWillFail"
      ) {
        throw new Error(
          reason
            ? `Lens post not finalized: ${reason}`
            : "Lens post not finalized: transaction request returned without post hash"
        );
      }
      throw new Error("Lens post failed: missing post hash in response");
    }

    const id = hash ? hash : `lens-${randomUUID()}`;

    const post: Post = {
      id,
      timestamp: new Date().toISOString(),
      metadata: { content: params.content, media: params.media },
      author: {
        address: normalizeAddress(params.actorAddress),
      },
      likes: [],
      replyCount: 0,
    };

    return post;
  } catch (error) {
    logger.error("lens.create_post.failed", { error });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ONBOARDING_USER")) {
      // try to refresh/switch account and retry once, since token may reflect
      // onboarding state from before minting occurred.
      await switchLensAccount(params.actorAddress, params.accessToken);
      try {
        // simulate again for second attempt
        maybeSimulateOnboarding(params.content);
        const contentUri = buildContentUri(params.content, params.media);
        const retryData = await executeVariants(
          [
            {
              query: `
                mutation Post($request: CreatePostRequest!) {
                  post(request: $request) {
                    ... on PostResponse { hash }
                    ... on SelfFundedTransactionRequest { reason }
                    ... on SponsoredTransactionRequest { reason }
                    ... on TransactionWillFail { reason }
                  }
                }
              `,
              variables: {
                request: { contentUri },
              },
            },
          ],
          params.accessToken
        );
        const retryResult = extractFirstResult(retryData);
        const hash = asString(retryResult?.hash);
        const id = hash ? hash : `lens-${randomUUID()}`;
        return {
          id,
          timestamp: new Date().toISOString(),
          metadata: { content: params.content, media: params.media },
          author: { address: normalizeAddress(params.actorAddress) },
          likes: [],
          replyCount: 0,
        } as Post;
      } catch (retryError) {
        logger.warn("lens.create_post.retry_after_switch_failed", { error: retryError });
      }
      // if retry didn't succeed, surface original onboarding error
      throw new LensOnboardingError(msg);
    }
    throw error;
  }
}

export async function createLensReply(params: {
  postId: string;
  content: string;
  actorAddress: string;
  accessToken: string;
}) {
  const contentUri = buildContentUri(params.content);
  const variants: MutationVariant[] = [
    {
      query: `
        mutation Post($request: CreatePostRequest!) {
          post(request: $request) {
            ... on PostResponse { hash }
            ... on SelfFundedTransactionRequest { reason }
            ... on SponsoredTransactionRequest { reason }
            ... on TransactionWillFail { reason }
          }
        }
      `,
      variables: {
        request: {
          contentUri,
          commentOn: { post: params.postId },
        },
      },
    },
  ];

  let data: Record<string, unknown> | null = null;
  const errors: string[] = [];

  for (const variant of variants) {
    try {
      data = await lensRequest<Record<string, unknown>, Record<string, unknown>>(
        variant.query,
        variant.variables,
        params.accessToken
      );
      const result = extractFirstResult(data);
      const id = asString(result?.id) ?? asString(result?.hash);
      if (id) {
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

      const reason = asString(result?.reason);
      if (reason) {
        errors.push(`Lens reply not finalized: ${reason}`);
        continue;
      }

      errors.push("Lens reply failed: missing id/hash in response");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Lens reply failed");
    }
  }

  const uniqueErrors = [...new Set(errors)];
  throw new Error(
    uniqueErrors.length > 0 ? uniqueErrors.join(" | ") : "Lens reply failed"
  );
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

export async function createLensRepost(params: {
  postId: string;
  accessToken: string;
}) {
  const data = await executeVariants(
    [
      {
        query: `
          mutation Post($request: CreatePostRequest!) {
            post(request: $request) {
              ... on PostResponse { hash }
              ... on SelfFundedTransactionRequest { reason }
              ... on SponsoredTransactionRequest { reason }
              ... on TransactionWillFail { reason }
            }
          }
        `,
        variables: {
          request: {
            repostOf: {
              post: params.postId,
            },
          },
        },
      },
      {
        query: `
          mutation Post($request: CreatePostRequest!) {
            post(request: $request) {
              ... on PostResponse { hash }
              ... on SelfFundedTransactionRequest { reason }
              ... on SponsoredTransactionRequest { reason }
              ... on TransactionWillFail { reason }
            }
          }
        `,
        variables: {
          request: {
            mirrorOn: {
              post: params.postId,
            },
          },
        },
      },
      {
        query: `
          mutation Post($request: CreatePostRequest!) {
            post(request: $request) {
              ... on PostResponse { hash }
              ... on SelfFundedTransactionRequest { reason }
              ... on SponsoredTransactionRequest { reason }
              ... on TransactionWillFail { reason }
            }
          }
        `,
        variables: {
          request: {
            mirrorOn: params.postId,
          },
        },
      },
    ],
    params.accessToken
  );

  const result = extractFirstResult(data);
  const publicationId = asString(result?.hash) ?? asString(result?.id);
  if (!publicationId) {
    const reason = asString(result?.reason);
    throw new Error(reason || "Lens repost failed: missing publication id");
  }

  return {
    publicationId,
    reposted: true,
  };
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
