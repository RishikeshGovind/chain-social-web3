import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/server/rate-limit";
import {
  isValidAddress,
  normalizeAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { createPost, getRepostsForPosts, listPosts } from "@/lib/posts/store";
import { validateMediaUrls } from "@/lib/posts/validation";
import { fetchLensPosts } from "@/lib/lens/feed";
import { createLensPost } from "@/lib/lens/writes";
import { lensRequest } from "@/lib/lens";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";
import { isPrimaryStateStoreHealthy } from "@/lib/server/persistence";

// Helper to get Lens account address from wallet address
async function getLensAccountAddress(walletAddress: string): Promise<string | null> {
  try {
    const data = await lensRequest<{
      accountsAvailable: {
        items: Array<{
          __typename: string;
          account?: { address: string };
        }>;
      };
    }>(
      `
        query AccountsAvailable($request: AccountsAvailableRequest!) {
          accountsAvailable(request: $request) {
            items {
              __typename
              ... on AccountOwned {
                account {
                  address
                }
              }
              ... on AccountManaged {
                account {
                  address
                }
              }
            }
          }
        }
      `,
      {
        request: {
          managedBy: walletAddress,
          includeOwned: true,
        },
      }
    );

    const items = data?.accountsAvailable?.items ?? [];
    // Prefer AccountOwned over AccountManaged
    const owned = items.find((i) => i.__typename === "AccountOwned");
    const managed = items.find((i) => i.__typename === "AccountManaged");
    const account = owned ?? managed;
    return account?.account?.address ?? null;
  } catch {
    return null;
  }
}

const LOCAL_MERGE_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_LENS_LOCAL_MERGE_TIMEOUT_MS ?? "700",
  10
);
const LOCAL_READ_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_LOCAL_READ_TIMEOUT_MS ?? "1200",
  10
);
const CHAIN_ONLY_WRITES = (() => {
  const raw = (process.env.CHAINSOCIAL_CHAIN_ONLY_WRITES ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeTimeout(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecentTimestamp(timestamp: string, windowMs: number) {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= windowMs;
}

function postSignature(input: {
  authorAddress: string;
  content?: string;
  media?: string[];
}) {
  const media = (input.media ?? []).join("|");
  return `${normalizeAddress(input.authorAddress)}|${(input.content ?? "").trim()}|${media}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10);
    const cursor = searchParams.get("cursor") ?? undefined;
    const author = searchParams.get("author") ?? undefined;
    const postId = searchParams.get("postId") ?? undefined;
    const source = searchParams.get("source");
    const quick = searchParams.get("quick") === "1";
    const debug = searchParams.get("debug") === "1";
    const debugSchema = searchParams.get("debugSchema") === "1";

    const boundedLimit = Number.isNaN(limit) ? 10 : limit;
    const useLensData =
      source === "lens" ||
      ((process.env.LENS_POSTS_SOURCE === "lens" ||
        process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens") &&
        source !== "local");

    if (useLensData) {
      try {
        const accessToken = await getLensAccessTokenFromCookie();
        const resolvedAuthor = author
          ? (await getLensAccountAddress(author)) ?? author
          : undefined;
        if (debugSchema) {
          const schemaQuery = `
            query LensSchemaDebug {
              postType: __type(name: "Post") {
                name
                fields {
                  name
                  type {
                    kind
                    name
                    ofType { kind name }
                  }
                }
              }
              anyPostType: __type(name: "AnyPost") {
                name
                possibleTypes { name }
                fields {
                  name
                  type {
                    kind
                    name
                    ofType { kind name }
                  }
                }
              }
              postsRequestType: __type(name: "PostsRequest") {
                name
                inputFields {
                  name
                  type {
                    kind
                    name
                    ofType { kind name }
                  }
                }
              }
              postMetadataUnion: __type(name: "PostMetadata") {
                name
                kind
                possibleTypes {
                  name
                }
              }
              postMetadataTypes: __type(name: "PostMetadataV3") {
                name
                fields {
                  name
                  type {
                    kind
                    name
                    ofType { kind name }
                  }
                }
              }
            }
          `;
          const schemaData = await lensRequest(schemaQuery, undefined, accessToken ?? undefined);
          return NextResponse.json({ source: "lens", schemaData });
        }

        const lensData = await fetchLensPosts({
          limit: boundedLimit,
          cursor,
          author: resolvedAuthor,
          postId,
          quick,
          debug,
          accessToken: accessToken ?? undefined,
        });

        const lensPosts = lensData.posts ?? [];
        let mergedPosts = lensPosts;
        let allowLocalEnrichment = isPrimaryStateStoreHealthy();

        // Merge recent local posts to cover Lens indexing delay after successful post publish.
        // This merge is best-effort and must not block feed responses.
        if (!cursor && allowLocalEnrichment) {
          try {
            const localData = await withTimeout(
              listPosts({
                limit: Math.min(50, Math.max(boundedLimit * 2, boundedLimit)),
                author: resolvedAuthor ?? author,
              }),
              Number.isFinite(LOCAL_MERGE_TIMEOUT_MS) && LOCAL_MERGE_TIMEOUT_MS > 0
                ? LOCAL_MERGE_TIMEOUT_MS
                : 700,
              "local merge fetch"
            );

            const lensIdSet = new Set(lensPosts.map((post) => post.id));
            const lensSigSet = new Set(
              lensPosts.map((post) =>
                postSignature({
                  authorAddress: post.author.address,
                  content: post.metadata?.content,
                  media: post.metadata?.media,
                })
              )
            );
            const recentWindowMs = 15 * 60 * 1000;
            const localPending = (localData.posts ?? []).filter((post) => {
              if (lensIdSet.has(post.id)) return false;
              if (!author && !isRecentTimestamp(post.timestamp, recentWindowMs)) {
                return false;
              }
              const sig = postSignature({
                authorAddress: post.author.address,
                content: post.metadata?.content,
                media: post.metadata?.media,
              });
              return !lensSigSet.has(sig);
            });

            mergedPosts = [...localPending, ...lensPosts]
              .sort((a, b) => {
                if (a.timestamp === b.timestamp) return b.id.localeCompare(a.id);
                return b.timestamp.localeCompare(a.timestamp);
              })
              .slice(0, boundedLimit);
          } catch (localMergeError) {
            const message =
              localMergeError instanceof Error ? localMergeError.message : "unknown local merge error";
            console.warn("[Post API] Skipping local merge for Lens feed:", message);
            allowLocalEnrichment = false;
          }
        } else if (!cursor) {
          console.warn("[Post API] Skipping local merge for Lens feed: primary state store unhealthy.");
        }

        let repostMap = new Map<string, string[]>();
        if (allowLocalEnrichment) {
          try {
            repostMap = await withTimeout(
              getRepostsForPosts(mergedPosts.map((post) => post.id)),
              Number.isFinite(LOCAL_MERGE_TIMEOUT_MS) && LOCAL_MERGE_TIMEOUT_MS > 0
                ? LOCAL_MERGE_TIMEOUT_MS
                : 700,
              "local repost enrichment"
            );
          } catch (repostError) {
            const message = repostError instanceof Error ? repostError.message : "unknown repost enrichment error";
            console.warn("[Post API] Skipping local repost enrichment for Lens feed:", message);
          }
        }

        const postsWithReposts = mergedPosts.map((post) => ({
          ...post,
          reposts: repostMap.get(post.id) ?? post.reposts ?? [],
        }));
        return NextResponse.json({
          ...lensData,
          posts: postsWithReposts,
          source: "lens",
          resolvedAuthor: resolvedAuthor ?? author ?? null,
          ...(debug ? { usedAccessToken: !!accessToken } : {}),
        });
      } catch (lensError) {
        const lensMessage =
          lensError instanceof Error ? lensError.message : "unknown error";
        console.warn(
          "Lens feed fetch failed, falling back to local store:",
          lensMessage
        );
        try {
          const localData = await withTimeout(
            listPosts({
              limit: boundedLimit,
              cursor,
              author,
            }),
            safeTimeout(LOCAL_READ_TIMEOUT_MS, 1200),
            "local fallback posts read"
          );
          return NextResponse.json({
            ...localData,
            source: "local",
            resolvedAuthor: author ?? null,
            lensFallbackError: lensMessage,
          });
        } catch (localError) {
          const localMessage =
            localError instanceof Error ? localError.message : "unknown local fallback error";
          console.error("Local feed fallback failed:", localMessage);
          // Keep feed route stable for clients even during backend incidents.
          return NextResponse.json({
            posts: [],
            nextCursor: null,
            source: "local",
            resolvedAuthor: author ?? null,
            lensFallbackError: lensMessage,
            localFallbackError: localMessage,
          });
        }
      }
    }

    let localData;
    try {
      localData = await withTimeout(
        listPosts({
          limit: boundedLimit,
          cursor,
          author,
        }),
        safeTimeout(LOCAL_READ_TIMEOUT_MS, 1200),
        "local posts read"
      );
    } catch (localError) {
      const localMessage =
        localError instanceof Error ? localError.message : "local feed unavailable";
      console.error("Local feed load failed:", localMessage);
      return NextResponse.json({
        posts: [],
        nextCursor: null,
        source: "local",
        resolvedAuthor: author ?? null,
        localFallbackError: localMessage,
      });
    }

    return NextResponse.json({
      ...localData,
      source: "local",
      resolvedAuthor: author ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch posts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before posting." },
        { status: 401 }
      );
    }

    const rateLimit = await checkPostRateLimit(actorAddress);
    if (!rateLimit.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
      return NextResponse.json(
        { error: rateLimit.error },
        {
          status: 429,
          headers: {
            "Retry-After": `${retryAfterSeconds}`,
          },
        }
      );
    }

    const body = await req.json();
    const parsedContent = parseAndValidateContent(body?.content);
    if (!parsedContent.ok) {
      return NextResponse.json({ error: parsedContent.error }, { status: 400 });
    }

    const username =
      typeof body?.author?.username?.localName === "string"
        ? body.author.username.localName.trim().slice(0, 32)
        : undefined;

    // Validate media using shared helper so we can write tests.
    const mediaValidation = validateMediaUrls(body?.media);
    if (!mediaValidation.ok) {
      return NextResponse.json({ error: mediaValidation.error }, { status: 400 });
    }
    const media = mediaValidation.urls.length > 0 ? mediaValidation.urls : undefined;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (CHAIN_ONLY_WRITES && !useLensData) {
      return NextResponse.json(
        {
          error:
            "Chain-only mode is enabled. Set LENS_POSTS_SOURCE=lens and connect Lens before posting.",
        },
        { status: 503 }
      );
    }

    if (useLensData) {
      const accessToken = await getLensAccessTokenFromCookie();
      
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens." },
          { status: 401 }
        );
      }

      // Lens v3 requires the Lens account address (not wallet address) for posting
      // Look up the user's Lens account address first
      const lensAccountAddress = await getLensAccountAddress(actorAddress);
      console.log("[Post API] Lens account address:", lensAccountAddress);
      
      if (!lensAccountAddress) {
        return NextResponse.json(
          { error: "You must mint a Lens profile before posting." },
          { status: 403 }
        );
      }

      try {
        console.log("[Post API] Creating Lens post...");
        const post = await createLensPost({
          content: parsedContent.content,
          actorAddress: lensAccountAddress, // Use Lens account address, not wallet
          accessToken,
          media,
        });
        // Mirror successful Lens posts to local store so they persist in UI even
        // when Lens indexing/session is delayed. Keep this non-blocking so
        // Postgres failover/read timeouts never delay the user-visible response.
        void createPost({
          id: post.id,
          timestamp: post.timestamp,
          address: lensAccountAddress,
          content: parsedContent.content,
          username,
          media,
          chainPostId: post.id,
          publishStatus: "published",
        }).catch((mirrorError) => {
          console.warn("[Post API] Local mirror write failed:", mirrorError);
        });
        console.log("[Post API] Lens post created:", post.id);
        return NextResponse.json({ success: true, post, source: "lens" });
      } catch (lensError) {
        const errorMsg = lensError instanceof Error ? lensError.message : "unknown error";
        console.error("[Post API] Lens post mutation failed:", errorMsg);
        
        if (lensError instanceof Error && lensError.name === "LensOnboardingError") {
          // inform client about onboarding requirement
          return NextResponse.json(
            { error: "You must mint a Lens profile before posting." },
            { status: 403 }
          );
        }
        
        // Return the actual Lens error instead of silently falling back
        return NextResponse.json(
          { error: `Lens post failed: ${errorMsg}`, lensError: errorMsg },
          { status: 500 }
        );
      }
    }

    const post = await createPost({
      address: actorAddress,
      content: parsedContent.content,
      username,
      media,
      publishStatus: "local_only",
    });

    return NextResponse.json({ success: true, post, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
