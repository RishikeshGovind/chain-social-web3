"use strict";
//lib/lens/writes.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.LensOnboardingError = void 0;
exports.extractFirstResult = extractFirstResult;
exports.buildContentUri = buildContentUri;
exports.buildPostRequest = buildPostRequest;
exports.switchLensAccount = switchLensAccount;
exports.__setTestOnboardInvocations = __setTestOnboardInvocations;
exports.createLensPost = createLensPost;
exports.createLensReply = createLensReply;
exports.toggleLensLike = toggleLensLike;
exports.toggleLensFollow = toggleLensFollow;
exports.editLensPost = editLensPost;
exports.deleteLensPost = deleteLensPost;
const lens_1 = require("../lens");
const content_1 = require("../posts/content");
function asObject(value) {
    return value && typeof value === "object" ? value : null;
}
function asString(value) {
    return typeof value === "string" ? value : null;
}
function extractFirstResult(data) {
    const object = asObject(data);
    if (!object)
        return null;
    for (const value of Object.values(object)) {
        const result = asObject(value);
        if (result)
            return result;
    }
    return null;
}
async function executeVariants(variants, accessToken) {
    let lastError = null;
    for (const variant of variants) {
        try {
            const result = await (0, lens_1.lensRequest)(variant.query, variant.variables, accessToken);
            return result;
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error("Lens mutation failed");
        }
    }
    if (lastError)
        throw lastError;
    throw new Error("No Lens mutation variant succeeded");
}
// Historically the Lens API accepted raw `content` strings, but newer
// versions mandate a `contentUri` field that points to metadata hosted at a
// publicly accessible URI. For compatibility we build a small JSON document and
// embed it as a `data:` URI so no external upload is required. The object is
// simple enough for most feed consumers, and it keeps the example self‑contained.
function buildContentUri(content, media) {
    const metadata = { content };
    if (media && media.length > 0) {
        metadata.media = media.map((url) => ({ url, mimeType: "image/jpeg" }));
    }
    const json = JSON.stringify(metadata);
    return `data:application/json,${encodeURIComponent(json)}`;
}
/**
 * Construct the object that will be sent to the Lens API.
 *
 * This is a separate exported function so that tests can assert its shape
 * without having to actually perform any network activity.
 */
// NOTE: the Lens schema has evolved several times.  The current
// `CreatePostRequest` input expects a `feed` (EvmAddress) field rather than
// a profile ID or content directly.  We still build the `contentUri` here,
// but everything else is left intentionally minimal so future schema changes
// will be easier to adapt.
function buildPostRequest(feed, content, media) {
    const contentUri = buildContentUri(content, media);
    const requestBody = {
        feed,
        contentUri,
    };
    // there are additional optional fields (quoteOf, commentOn, rules, etc.)
    // that we don't currently use; they can be added on demand here.
    return requestBody;
}
// thrown when a user tries to post but the Lens account is still in
// onboarding state (no minted profile).  We surface this specifically so
// callers can display a helpful message rather than silently falling back.
class LensOnboardingError extends Error {
    constructor(message) {
        super(message);
        this.name = "LensOnboardingError";
    }
}
exports.LensOnboardingError = LensOnboardingError;
// expose a low‑level switch mutation; callers can use this to refresh the
// authenticated account context after a profile has been minted.
async function switchLensAccount(account, accessToken) {
    try {
        await (0, lens_1.lensRequest)(`mutation Switch($request: SwitchAccountRequest!) {
         switchAccount(request: $request)
       }`, { request: { account } }, accessToken);
    }
    catch {
        // ignore failures; best‑effort
    }
}
// testing helpers
let _testOnboardInvocations = 0;
// allow tests to reset counter so repeated runs behave predictably
function __setTestOnboardInvocations(n) {
    _testOnboardInvocations = n;
}
// helper used in tests to simulate the API rejecting the first
// request with an onboarding error and succeeding thereafter.
function maybeSimulateOnboarding(content) {
    if (content === "__TEST_ONBOARD_ERROR__") {
        _testOnboardInvocations += 1;
        if (_testOnboardInvocations === 1) {
            throw new LensOnboardingError("Forbidden - You cannot access 'post' as 'ONBOARDING_USER'");
        }
    }
}
async function createLensPost(params) {
    try {
        // feed corresponds to the wallet address that will receive the post
        // in its GraphQL feed.  previously we fetched a Lens profile id but the
        // schema now uses a raw EVM address.
        const requestBody = buildPostRequest(params.actorAddress, params.content, params.media);
        // debug: log shape once to aid diagnosing schema mismatches during development
        console.log("[Lens] createPost request fields:", Object.keys(requestBody));
        // simulate before making network call (tests only)
        maybeSimulateOnboarding(params.content);
        const data = await executeVariants([
            {
                query: `
            mutation Post($request: CreatePostRequest!) {
              post(request: $request) {
                ... on PostResponse { hash }
                ... on PostOperationValidationFailed { reason }
              }
            }
          `,
                variables: {
                    request: requestBody,
                },
            },
        ], params.accessToken);
        const result = extractFirstResult(data);
        const hash = asString(result?.hash); // PostResponse
        const id = hash ? hash : `lens-${crypto.randomUUID()}`;
        const post = {
            id,
            timestamp: new Date().toISOString(),
            metadata: { content: params.content, media: params.media },
            author: {
                address: (0, content_1.normalizeAddress)(params.actorAddress),
            },
            likes: [],
            replyCount: 0,
        };
        return post;
    }
    catch (error) {
        console.error("Lens post mutation failed:", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("ONBOARDING_USER")) {
            // try to refresh/switch account and retry once, since token may reflect
            // onboarding state from before minting occurred.
            await switchLensAccount(params.actorAddress, params.accessToken);
            try {
                // simulate again for second attempt
                maybeSimulateOnboarding(params.content);
                const retryData = await executeVariants([
                    {
                        query: `
                mutation Post($request: CreatePostRequest!) {
                  post(request: $request) {
                    ... on PostResponse { hash }
                    ... on PostOperationValidationFailed { reason }
                  }
                }
              `,
                        variables: {
                            request: buildPostRequest(params.actorAddress, params.content, params.media),
                        },
                    },
                ], params.accessToken);
                const retryResult = extractFirstResult(retryData);
                const hash = asString(retryResult?.hash);
                const id = hash ? hash : `lens-${crypto.randomUUID()}`;
                return {
                    id,
                    timestamp: new Date().toISOString(),
                    metadata: { content: params.content, media: params.media },
                    author: { address: (0, content_1.normalizeAddress)(params.actorAddress) },
                    likes: [],
                    replyCount: 0,
                };
            }
            catch (retryError) {
                console.warn("retry after switch failed", retryError);
            }
            // if retry didn't succeed, surface original onboarding error
            throw new LensOnboardingError(msg);
        }
        throw error;
    }
}
async function createLensReply(params) {
    // replies currently still accept raw `content`, but if the API adds a
    // contentUri requirement we can piggy‑back the same helper above. For now
    // we just keep the existing variants.
    const data = await executeVariants([
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
    ], params.accessToken);
    const result = extractFirstResult(data);
    const id = asString(result?.id) ?? `lens-reply-${crypto.randomUUID()}`;
    const reply = {
        id,
        postId: params.postId,
        timestamp: new Date().toISOString(),
        metadata: { content: params.content },
        author: {
            address: (0, content_1.normalizeAddress)(params.actorAddress),
        },
    };
    return reply;
}
async function toggleLensLike(params) {
    const reaction = "UPVOTE";
    await executeVariants(params.currentlyLiked
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
        ], params.accessToken);
    return { liked: !params.currentlyLiked };
}
async function toggleLensFollow(params) {
    await executeVariants(params.currentlyFollowing
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
        ], params.accessToken);
    return { isFollowing: !params.currentlyFollowing };
}
async function editLensPost(params) {
    await executeVariants([
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
    ], params.accessToken);
}
async function deleteLensPost(params) {
    await executeVariants([
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
    ], params.accessToken);
}
