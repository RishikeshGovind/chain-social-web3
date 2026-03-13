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
import { logger } from "@/lib/server/logger";
import {
  evaluateTextSafety,
  filterVisiblePosts,
  isAddressBanned,
  isMediaBlockedOrQuarantined,
  moderateIncomingPosts,
} from "@/lib/server/moderation/store";
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
  process.env.CHAINSOCIAL_LENS_LOCAL_MERGE_TIMEOUT_MS ?? "800",
  10
);
const LOCAL_READ_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_LOCAL_READ_TIMEOUT_MS ?? "4000",
  10
);
const RELAXED_LOCAL_READ_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_RELAXED_LOCAL_READ_TIMEOUT_MS ?? "10000",
  10
);
const FEED_CACHE_TTL_MS = Number.parseInt(
  process.env.CHAINSOCIAL_FEED_CACHE_TTL_MS ?? "10000",
  10
);
const LOCAL_MERGE_BUFFER = Number.parseInt(
  process.env.CHAINSOCIAL_LENS_LOCAL_MERGE_BUFFER ?? "6",
  10
);
const LOCAL_MERGE_MAX = Number.parseInt(
  process.env.CHAINSOCIAL_LENS_LOCAL_MERGE_MAX ?? "24",
  10
);
const CHAIN_ONLY_WRITES = (() => {
  const raw = (process.env.CHAINSOCIAL_CHAIN_ONLY_WRITES ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();

// Simple in-memory feed cache to avoid repeating the full pipeline on rapid reloads
const feedCache = new Map<string, { data: unknown; ts: number }>();
const MAX_FEED_CACHE_ENTRIES = 50;

function getFeedCacheKey(params: Record<string, string | undefined>) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function getCachedFeed(key: string): unknown | null {
  const entry = feedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > FEED_CACHE_TTL_MS) {
    feedCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedFeed(key: string, data: unknown) {
  // Evict oldest entries if cache is full
  if (feedCache.size >= MAX_FEED_CACHE_ENTRIES) {
    const oldest = feedCache.keys().next().value;
    if (oldest !== undefined) feedCache.delete(oldest);
  }
  feedCache.set(key, { data, ts: Date.now() });
}

export function invalidateFeedCache() {
  feedCache.clear();
}

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

function isTimeoutError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("timed out");
}

function postSignature(input: {
  authorAddress: string;
  content?: string;
  media?: string[];
}) {
  const media = (input.media ?? []).join("|");
  return `${normalizeAddress(input.authorAddress)}|${(input.content ?? "").trim()}|${media}`;
}

type TimingMap = Record<string, number>;

function createTimings(enabled: boolean) {
  const startedAt = Date.now();
  const marks = new Map<string, number>();

  return {
    enabled,
    start(label: string) {
      if (!enabled) return;
      marks.set(label, Date.now());
    },
    end(label: string, bucket: TimingMap) {
      if (!enabled) return;
      const start = marks.get(label);
      if (start === undefined) return;
      bucket[label] = Date.now() - start;
      marks.delete(label);
    },
    total(bucket: TimingMap) {
      if (!enabled) return;
      bucket.total = Date.now() - startedAt;
    },
  };
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
    // Debug/schema introspection only available in non-production environments
    const isProduction = process.env.NODE_ENV === "production";
    const debug = !isProduction && searchParams.get("debug") === "1";
    const timingEnabled = !isProduction && searchParams.get("timing") === "1";
    const timings: TimingMap = {};
    const timer = createTimings(timingEnabled);

    const boundedLimit = Number.isNaN(limit) ? 10 : limit;

    // Include actor address in cache key to prevent cross-user cache pollution
    const actorForCache = await getActorAddressFromLensCookie().catch(() => null);

    // Check feed cache for non-debug, non-schema requests
    const cacheKey = !debug
      ? getFeedCacheKey({ limit: String(boundedLimit), cursor, author, postId, source: source ?? undefined, actor: actorForCache ?? "anon" })
      : null;
    if (cacheKey) {
      const cached = getCachedFeed(cacheKey);
      if (cached) {
        if (timingEnabled && cached && typeof cached === "object") {
          return NextResponse.json({
            ...(cached as Record<string, unknown>),
            timings: { cacheHit: 0, total: 0 },
          });
        }
        return NextResponse.json(cached);
      }
    }
    const useLensData =
      source === "lens" ||
      ((process.env.LENS_POSTS_SOURCE === "lens" ||
        process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens") &&
        source !== "local");

    if (useLensData) {
      try {
        const accessToken = await getLensAccessTokenFromCookie();
        timer.start("lensAccountLookup");
        const resolvedAuthor = author
          ? (await getLensAccountAddress(author)) ?? author
          : undefined;
        timer.end("lensAccountLookup", timings);

        // Start Lens fetch and local fetch in parallel (local is best-effort for merge)
        let allowLocalEnrichment = isPrimaryStateStoreHealthy() && !quick;
        const localMergePromise = !cursor && allowLocalEnrichment
          ? withTimeout(
              listPosts({
                limit: Math.min(
                  Number.isFinite(LOCAL_MERGE_MAX) && LOCAL_MERGE_MAX > 0 ? LOCAL_MERGE_MAX : 24,
                  boundedLimit +
                    (Number.isFinite(LOCAL_MERGE_BUFFER) && LOCAL_MERGE_BUFFER > 0
                      ? LOCAL_MERGE_BUFFER
                      : 6)
                ),
                author: resolvedAuthor ?? author,
              }),
              Number.isFinite(LOCAL_MERGE_TIMEOUT_MS) && LOCAL_MERGE_TIMEOUT_MS > 0
                ? LOCAL_MERGE_TIMEOUT_MS
                : 500,
              "local merge fetch"
            ).catch((err) => {
              const message = err instanceof Error ? err.message : "unknown local merge error";
              logger.warn("posts.feed.local_merge_skipped", { reason: message });
              allowLocalEnrichment = false;
              return null;
            })
          : Promise.resolve(null);

        timer.start("lensFetch");
        const lensData = await fetchLensPosts({
          limit: boundedLimit,
          cursor,
          author: resolvedAuthor,
          postId,
          quick,
          debug,
          accessToken: accessToken ?? undefined,
        });
        timer.end("lensFetch", timings);

        const lensPosts = lensData.posts ?? [];
        let mergedPosts = lensPosts;

        if (!cursor && allowLocalEnrichment) {
          timer.start("localMergeWait");
          const localData = await localMergePromise;
          timer.end("localMergeWait", timings);
          if (localData) {
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
          }
        } else if (!cursor) {
          logger.warn("posts.feed.local_merge_skipped", {
            reason: "primary state store unhealthy",
          });
        }

        // Run repost enrichment and visibility filtering in parallel
        const repostPromise = allowLocalEnrichment
          ? withTimeout(
              getRepostsForPosts(mergedPosts.map((post) => post.id)),
              Number.isFinite(LOCAL_MERGE_TIMEOUT_MS) && LOCAL_MERGE_TIMEOUT_MS > 0
                ? LOCAL_MERGE_TIMEOUT_MS
                : 500,
              "local repost enrichment"
            ).catch((err) => {
              const message = err instanceof Error ? err.message : "unknown repost enrichment error";
              logger.warn("posts.feed.repost_enrichment_skipped", { reason: message });
              return new Map<string, string[]>();
            })
          : Promise.resolve(new Map<string, string[]>());

        timer.start("repostEnrichment");
        timer.start("filterVisiblePosts");
        const [repostMap, filteredPosts] = await Promise.all([
          repostPromise.then((result) => {
            timer.end("repostEnrichment", timings);
            return result;
          }),
          filterVisiblePosts(mergedPosts).then((result) => {
            timer.end("filterVisiblePosts", timings);
            return result;
          }),
        ]);

        // Scan post content through moderation layers (catches illegal content from other Lens apps)
        timer.start("moderateIncomingPosts");
        const moderatedPosts = await moderateIncomingPosts(filteredPosts);
        timer.end("moderateIncomingPosts", timings);

        const visiblePosts = moderatedPosts.map((post) => ({
          ...post,
          reposts: repostMap.get(post.id) ?? post.reposts ?? [],
        }));
        const responseData = {
          ...lensData,
          posts: visiblePosts,
          source: "lens",
          resolvedAuthor: resolvedAuthor ?? author ?? null,
          ...(timingEnabled ? { timings: (() => {
            timer.total(timings);
            return timings;
          })() } : {}),
          ...(debug ? { usedAccessToken: !!accessToken } : {}),
        };
        if (cacheKey) setCachedFeed(cacheKey, responseData);
        return NextResponse.json(responseData);
      } catch (lensError) {
        const lensMessage =
          lensError instanceof Error ? lensError.message : "unknown error";
        logger.warn("posts.feed.lens_fallback", { reason: lensMessage });
        try {
          timer.start("localFallbackRead");
          const localData = await withTimeout(
            listPosts({
              limit: boundedLimit,
              cursor,
              author,
            }),
            safeTimeout(LOCAL_READ_TIMEOUT_MS, 1200),
            "local fallback posts read"
          );
          timer.end("localFallbackRead", timings);
          timer.start("filterVisiblePosts");
          const filtered = await filterVisiblePosts(localData.posts ?? []);
          timer.end("filterVisiblePosts", timings);
          timer.start("moderateIncomingPosts");
          const visiblePosts = await moderateIncomingPosts(filtered);
          timer.end("moderateIncomingPosts", timings);
          const responseData = {
            ...localData,
            posts: visiblePosts,
            source: "local",
            resolvedAuthor: author ?? null,
            lensFallbackError: lensMessage,
            ...(timingEnabled ? { timings: (() => {
              timer.total(timings);
              return timings;
            })() } : {}),
          };
          if (cacheKey) setCachedFeed(cacheKey, responseData);
          return NextResponse.json(responseData);
        } catch (localError) {
          if (isTimeoutError(localError)) {
            try {
              timer.start("relaxedLocalFallbackRead");
              const relaxedLocalData = await withTimeout(
                listPosts({
                  limit: boundedLimit,
                  cursor,
                  author,
                }),
                safeTimeout(RELAXED_LOCAL_READ_TIMEOUT_MS, 10000),
                "relaxed local fallback posts read"
              );
              timer.end("relaxedLocalFallbackRead", timings);
              timer.start("filterVisiblePosts");
              const filtered = await filterVisiblePosts(relaxedLocalData.posts ?? []);
              timer.end("filterVisiblePosts", timings);
              timer.start("moderateIncomingPosts");
              const visiblePosts = await moderateIncomingPosts(filtered);
              timer.end("moderateIncomingPosts", timings);
              return NextResponse.json({
                ...relaxedLocalData,
                posts: visiblePosts,
                source: "local",
                resolvedAuthor: author ?? null,
                lensFallbackError: lensMessage,
                ...(timingEnabled ? { timings: (() => {
                  timer.total(timings);
                  return timings;
                })() } : {}),
                localFallbackWarning:
                  localError instanceof Error ? localError.message : "local fallback was slow",
              });
            } catch (relaxedLocalError) {
              const relaxedMessage =
                relaxedLocalError instanceof Error
                  ? relaxedLocalError.message
                  : "unknown relaxed local fallback error";
              logger.error("posts.feed.relaxed_local_fallback_failed", { error: relaxedMessage });
              return NextResponse.json({
                posts: [],
                nextCursor: null,
                source: "local",
                resolvedAuthor: author ?? null,
                lensFallbackError: lensMessage,
                localFallbackError: relaxedMessage,
              });
            }
          }

          const localMessage =
            localError instanceof Error ? localError.message : "unknown local fallback error";
          logger.error("posts.feed.local_fallback_failed", { error: localMessage });
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
      if (isTimeoutError(localError)) {
        try {
          timer.start("relaxedLocalRead");
          localData = await withTimeout(
            listPosts({
              limit: boundedLimit,
              cursor,
              author,
            }),
            safeTimeout(RELAXED_LOCAL_READ_TIMEOUT_MS, 10000),
            "relaxed local posts read"
          );
          timer.end("relaxedLocalRead", timings);
          timer.start("filterVisiblePosts");
          const filtered = await filterVisiblePosts(localData.posts ?? []);
          timer.end("filterVisiblePosts", timings);
          timer.start("moderateIncomingPosts");
          const visiblePosts = await moderateIncomingPosts(filtered);
          timer.end("moderateIncomingPosts", timings);
          return NextResponse.json({
            ...localData,
            posts: visiblePosts,
            source: "local",
            resolvedAuthor: author ?? null,
            ...(timingEnabled ? { timings: (() => {
              timer.total(timings);
              return timings;
            })() } : {}),
            localFallbackWarning:
              localError instanceof Error ? localError.message : "local feed was slow",
          });
        } catch (relaxedLocalError) {
          const relaxedMessage =
            relaxedLocalError instanceof Error
              ? relaxedLocalError.message
              : "local feed unavailable";
              logger.error("posts.feed.relaxed_local_load_failed", { error: relaxedMessage });
          return NextResponse.json({
            posts: [],
            nextCursor: null,
            source: "local",
            resolvedAuthor: author ?? null,
            localFallbackError: relaxedMessage,
          });
        }
      }

      const localMessage =
        localError instanceof Error ? localError.message : "local feed unavailable";
      logger.error("posts.feed.local_load_failed", { error: localMessage });
      return NextResponse.json({
        posts: [],
        nextCursor: null,
        source: "local",
        resolvedAuthor: author ?? null,
        localFallbackError: localMessage,
      });
    }

    timer.start("localRead");
    const filtered = await filterVisiblePosts(localData.posts ?? []);
    timer.end("localRead", timings);
    timer.start("moderateIncomingPosts");
    const visiblePosts = await moderateIncomingPosts(filtered);
    timer.end("moderateIncomingPosts", timings);
    const responseData = {
      ...localData,
      posts: visiblePosts,
      source: "local",
      resolvedAuthor: author ?? null,
      ...(timingEnabled ? { timings: (() => {
        timer.total(timings);
        return timings;
      })() } : {}),
    };
    if (cacheKey) setCachedFeed(cacheKey, responseData);
    return NextResponse.json(responseData);
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

    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json(
        { error: "Your account is restricted from posting." },
        { status: 403 }
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
    const safety = await evaluateTextSafety({
      address: actorAddress,
      text: parsedContent.content,
      type: "post",
    });
    if (safety.thresholdTriggered) {
      return NextResponse.json(
        { error: "Posting restricted due to unusual activity. Try again later." },
        { status: 429 }
      );
    }
    if (safety.decision === "block") {
      return NextResponse.json(
        { error: safety.reasons[0] ?? "Post blocked by safety system." },
        { status: 400 }
      );
    }
    if (safety.decision === "review") {
      return NextResponse.json(
        { error: "Post held by automated safety checks. Please edit and try again." },
        { status: 400 }
      );
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
    if (media) {
      for (const url of media) {
        if (await isMediaBlockedOrQuarantined(url)) {
          return NextResponse.json(
            { error: "One or more media files are pending review or unavailable." },
            { status: 400 }
          );
        }
      }
    }

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
      logger.debug("posts.create.lens_account_resolved", {
        hasLensAccountAddress: !!lensAccountAddress,
      });
      
      if (!lensAccountAddress) {
        return NextResponse.json(
          { error: "You must mint a Lens profile before posting." },
          { status: 403 }
        );
      }

      try {
        logger.debug("posts.create.lens_post_start");
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
          logger.warn("posts.create.local_mirror_failed", { error: mirrorError });
        });
        logger.info("posts.create.lens_post_created", { postId: post.id });
        invalidateFeedCache();
        return NextResponse.json({ success: true, post, source: "lens" });
      } catch (lensError) {
        const errorMsg = lensError instanceof Error ? lensError.message : "unknown error";
        logger.error("posts.create.lens_post_failed", { error: errorMsg });
        
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

    invalidateFeedCache();
    return NextResponse.json({ success: true, post, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
