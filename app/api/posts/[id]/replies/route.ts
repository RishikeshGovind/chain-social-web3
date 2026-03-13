import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkReplyRateLimit } from "@/lib/server/rate-limit";
import {
  isValidAddress,
  normalizeAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { createReply, listReplies, upsertReply } from "@/lib/posts/store";
import { createLensReply } from "@/lib/lens/writes";
import { lensRequest } from "@/lib/lens";
import { fetchLensReplies } from "@/lib/lens/feed";
import { notifyPostReplied } from "@/lib/server/notifications/helpers";
import { logger } from "@/lib/server/logger";
import {
  evaluateTextSafety,
  filterVisibleReplies,
  isAddressBanned,
  moderateIncomingReplies,
} from "@/lib/server/moderation/store";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
  isTokenExpired,
} from "@/lib/server/auth/lens-actor";

function toTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  if (/^\d{10,13}$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return value.length === 10 ? numeric * 1000 : numeric;
    }
  }
  return 0;
}

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
    const owned = items.find((i) => i.__typename === "AccountOwned");
    const managed = items.find((i) => i.__typename === "AccountManaged");
    const account = owned ?? managed;
    return account?.account?.address ?? null;
  } catch {
    return null;
  }
}

type RefreshedTokens = {
  accessToken: string;
  refreshToken: string;
};

async function refreshLensTokensFromCookie(): Promise<RefreshedTokens | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("lensRefreshToken")?.value;
  if (!refreshToken) return null;

  try {
    const data = await lensRequest<{
      refresh: {
        accessToken?: string;
        refreshToken?: string;
        reason?: string;
      };
    }>(
      `
        mutation Refresh($request: RefreshRequest!) {
          refresh(request: $request) {
            __typename
            ... on AuthenticationTokens {
              accessToken
              refreshToken
            }
            ... on ForbiddenError {
              reason
            }
          }
        }
      `,
      {
        request: {
          refreshToken,
        },
      }
    );

    if (!data.refresh?.accessToken || !data.refresh?.refreshToken) {
      return null;
    }

    return {
      accessToken: data.refresh.accessToken,
      refreshToken: data.refresh.refreshToken,
    };
  } catch {
    return null;
  }
}

function applyRefreshedCookies(response: NextResponse, refreshed: RefreshedTokens | null) {
  if (!refreshed) return;
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("lensAccessToken", refreshed.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  response.cookies.set("lensRefreshToken", refreshed.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

const LOCAL_REPLIES_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_LOCAL_REPLIES_TIMEOUT_MS ?? "700",
  10
);

function safeTimeout(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("timed out");
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

type TimingMap = Record<string, number>;

function createTimings(enabled: boolean) {
  const startedAt = Date.now();
  const marks = new Map<string, number>();

  return {
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

async function confirmLensPostById(id: string, accessToken: string): Promise<boolean> {
  const queryVariants: Array<{ query: string; variables: Record<string, unknown> }> = [
    {
      query: `
        query Post($request: PostRequest!) {
          post(request: $request) {
            __typename
            ... on Post {
              id
            }
          }
        }
      `,
      variables: {
        request: {
          for: id,
        },
      },
    },
    {
      query: `
        query Post($request: PostRequest!) {
          post(request: $request) {
            __typename
            ... on Post {
              id
            }
          }
        }
      `,
      variables: {
        request: {
          post: id,
        },
      },
    },
    {
      query: `
        query Post($request: PostRequest!) {
          post(request: $request) {
            __typename
            ... on Post {
              id
            }
          }
        }
      `,
      variables: {
        request: {
          id,
        },
      },
    },
  ];

  for (const variant of queryVariants) {
    try {
      const data = await lensRequest(variant.query, variant.variables, accessToken);
      const root = asObject(data);
      const post = asObject(root?.post);
      if (post && asString(post.id)) {
        return true;
      }
    } catch {
      // keep trying query variants
    }
  }

  return false;
}

async function confirmLensReplyPublished(input: {
  postId: string;
  content: string;
  actorAddress: string;
  accessToken: string;
  expectedReplyId?: string;
  submittedAtMs: number;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = input.attempts ?? 10;
  const delayMs = input.delayMs ?? 1800;
  const expectedContent = normalizeText(input.content);
  const expectedAuthor = normalizeAddress(input.actorAddress);

  for (let i = 0; i < attempts; i += 1) {
    if (input.expectedReplyId) {
      const existsById = await confirmLensPostById(input.expectedReplyId, input.accessToken);
      if (existsById) {
        return {
          id: input.expectedReplyId,
          postId: input.postId,
          timestamp: new Date().toISOString(),
          metadata: { content: input.content },
          author: { address: expectedAuthor },
        };
      }
    }

    const allReplies = [];
    let cursor: string | undefined = undefined;
    for (let page = 0; page < 3; page += 1) {
      const lensReplies = await fetchLensReplies({
        postId: input.postId,
        limit: 50,
        cursor,
        accessToken: input.accessToken,
      });
      allReplies.push(...lensReplies.replies);
      if (!lensReplies.nextCursor) break;
      cursor = lensReplies.nextCursor;
    }

    const match = allReplies.find((reply) => {
      const byAuthor = normalizeAddress(reply.author.address) === expectedAuthor;
      if (!byAuthor) return false;

      const replyText = normalizeText(reply.metadata?.content ?? "");
      const textMatches =
        replyText === expectedContent ||
        replyText.includes(expectedContent) ||
        expectedContent.includes(replyText);

      const replyTs = Date.parse(reply.timestamp);
      const recentEnough =
        !Number.isNaN(replyTs) && replyTs >= input.submittedAtMs - 10_000;

      return textMatches || recentEnough;
    });
    if (match) return match;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const cursor = searchParams.get("cursor") ?? undefined;
    const timingEnabled = searchParams.get("timing") === "1";
    const timings: TimingMap = {};
    const timer = createTimings(timingEnabled);
    const boundedLimit = Number.isNaN(limit) ? 20 : limit;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      try {
        const accessToken = await getLensAccessTokenFromCookie();
        timer.start("lensRepliesFetch");
        const lensData = await fetchLensReplies({
          postId,
          limit: boundedLimit,
          cursor,
          accessToken: accessToken ?? undefined,
        });
        timer.end("lensRepliesFetch", timings);
        timer.start("localRepliesFetch");
        const localData = await withTimeout(
          listReplies({
            postId,
            limit: boundedLimit,
            cursor,
          }),
          safeTimeout(LOCAL_REPLIES_TIMEOUT_MS, 700),
          "local replies fetch"
        )
          .then((result) => {
            timer.end("localRepliesFetch", timings);
            return result;
          })
          .catch((localError) => {
            timer.end("localRepliesFetch", timings);
            const message =
              localError instanceof Error ? localError.message : "unknown local replies error";
            logger.warn("posts.replies.local_merge_skipped", {
              error: message,
              timedOut: isTimeoutError(localError),
            });
            return { replies: [], nextCursor: null };
          });
        const merged = [...(lensData.replies ?? []), ...(localData.replies ?? [])]
          .sort((a, b) => {
            const timeDelta = toTimestampMs(b.timestamp) - toTimestampMs(a.timestamp);
            if (timeDelta !== 0) return timeDelta;
            return b.id.localeCompare(a.id);
          })
          .filter((reply, index, arr) => arr.findIndex((r) => r.id === reply.id) === index)
          .slice(0, boundedLimit);
        timer.start("filterVisibleReplies");
        const filteredReplies = await filterVisibleReplies(merged);
        timer.end("filterVisibleReplies", timings);
        timer.start("moderateIncomingReplies");
        const visibleReplies = await moderateIncomingReplies(filteredReplies);
        timer.end("moderateIncomingReplies", timings);
        return NextResponse.json({
          replies: visibleReplies,
          nextCursor: lensData.nextCursor ?? localData.nextCursor ?? null,
          source: "lens",
          ...(timingEnabled ? { timings: (() => {
            timer.total(timings);
            return timings;
          })() } : {}),
        });
      } catch (lensError) {
        const message =
          lensError instanceof Error ? lensError.message : "unknown error";
        logger.warn("posts.replies.fetch_lens_fallback", { error: message });
      }
    }

    let data;
    try {
      timer.start("localRepliesFetch");
      data = await listReplies({
        postId,
        limit: boundedLimit,
        cursor,
      });
      timer.end("localRepliesFetch", timings);
    } catch (localError) {
      const localMessage =
        localError instanceof Error ? localError.message : "local replies unavailable";
      logger.error("posts.replies.local_load_failed", { error: localMessage });
      return NextResponse.json({
        replies: [],
        nextCursor: null,
        localFallbackError: localMessage,
      });
    }

    timer.start("filterVisibleReplies");
    const filteredReplies = await filterVisibleReplies(data.replies ?? []);
    timer.end("filterVisibleReplies", timings);
    timer.start("moderateIncomingReplies");
    const visibleReplies = await moderateIncomingReplies(filteredReplies);
    timer.end("moderateIncomingReplies", timings);
    return NextResponse.json({
      ...data,
      replies: visibleReplies,
      ...(timingEnabled ? { timings: (() => {
        timer.total(timings);
        return timings;
      })() } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load replies";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before replying." },
        { status: 401 }
      );
    }

    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json(
        { error: "Your account is restricted from replying." },
        { status: 403 }
      );
    }

    const rateLimit = await checkReplyRateLimit(actorAddress);
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

    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const body = await req.json();
    const parsedContent = parseAndValidateContent(body?.content);
    if (!parsedContent.ok) {
      return NextResponse.json({ error: parsedContent.error }, { status: 400 });
    }
    const safety = await evaluateTextSafety({
      address: actorAddress,
      text: parsedContent.content,
      type: "reply",
    });
    if (safety.thresholdTriggered) {
      return NextResponse.json(
        { error: "Replying restricted due to unusual activity. Try again later." },
        { status: 429 }
      );
    }
    if (safety.decision === "block") {
      return NextResponse.json(
        { error: safety.reasons[0] ?? "Reply blocked by safety system." },
        { status: 400 }
      );
    }
    if (safety.decision === "review") {
      return NextResponse.json(
        { error: "Reply held by automated safety checks. Please edit and try again." },
        { status: 400 }
      );
    }

    const username =
      typeof body?.author?.username?.localName === "string"
        ? body.author.username.localName.trim().slice(0, 32)
        : undefined;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      let accessToken = await getLensAccessTokenFromCookie();
      let refreshedTokens: RefreshedTokens | null = null;
      if (!accessToken || isTokenExpired(accessToken)) {
        refreshedTokens = await refreshLensTokensFromCookie();
        accessToken = refreshedTokens?.accessToken ?? accessToken;
      }
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens." },
          { status: 401 }
        );
      }

      try {
        const lensAccountAddress =
          (await getLensAccountAddress(actorAddress)) ?? actorAddress;
        const submittedAtMs = Date.now();
        const publishReply = async (token: string) =>
          createLensReply({
            postId,
            content: parsedContent.content,
            actorAddress: lensAccountAddress,
            accessToken: token,
          });

        const reply = await publishReply(accessToken);
        const confirmedReply = await confirmLensReplyPublished({
          postId,
          content: parsedContent.content,
          actorAddress: lensAccountAddress,
          accessToken,
          expectedReplyId: reply.id,
          submittedAtMs,
        });
        if (!reply) {
          throw new Error("Lens reply publish failed: empty response");
        }
        if (!confirmedReply) {
          const pendingResponse = NextResponse.json(
            {
              success: true,
              reply,
              replyCount: null,
              source: "lens",
              status: "pending_indexing",
              warning:
                "Reply submitted to Lens, but indexing confirmation is still pending.",
            },
            { status: 202 }
          );
          applyRefreshedCookies(pendingResponse, refreshedTokens);
          return pendingResponse;
        }
        const mirror = await upsertReply({
          id: confirmedReply.id,
          postId,
          address: lensAccountAddress,
          content: parsedContent.content,
          username,
          timestamp: confirmedReply.timestamp,
        });
        const successResponse = NextResponse.json({
          success: true,
          reply: mirror.reply,
          replyCount: mirror.replyCount,
          source: "lens",
        });
        await notifyPostReplied({
          postId,
          replyId: mirror.reply.id,
          actorAddress,
          accessToken,
        });
        applyRefreshedCookies(successResponse, refreshedTokens);
        return successResponse;
      } catch (lensError) {
        let message =
          lensError instanceof Error ? lensError.message : "unknown error";
        const isUnauthenticated =
          message.toLowerCase().includes("unauthenticated") ||
          message.toLowerCase().includes("authentication is required");

        // Retry once with freshly refreshed token if mutation failed due to auth.
        if (isUnauthenticated) {
          const retryTokens = await refreshLensTokensFromCookie();
          if (retryTokens?.accessToken) {
            try {
              const lensAccountAddress =
                (await getLensAccountAddress(actorAddress)) ?? actorAddress;
              const reply = await createLensReply({
                postId,
                content: parsedContent.content,
                actorAddress: lensAccountAddress,
                accessToken: retryTokens.accessToken,
              });
              const confirmedReply = await confirmLensReplyPublished({
                postId,
                content: parsedContent.content,
                actorAddress: lensAccountAddress,
                accessToken: retryTokens.accessToken,
                expectedReplyId: reply.id,
                submittedAtMs: Date.now(),
              });
              if (!reply) {
                throw new Error("Lens reply publish failed: empty response");
              }
              if (!confirmedReply) {
                const pendingResponse = NextResponse.json(
                  {
                    success: true,
                    reply,
                    replyCount: null,
                    source: "lens",
                    status: "pending_indexing",
                    warning:
                      "Reply submitted to Lens, but indexing confirmation is still pending.",
                  },
                  { status: 202 }
                );
                applyRefreshedCookies(pendingResponse, retryTokens);
                return pendingResponse;
              }
              const mirror = await upsertReply({
                id: confirmedReply.id,
                postId,
                address: lensAccountAddress,
                content: parsedContent.content,
                username,
                timestamp: confirmedReply.timestamp,
              });
              const successResponse = NextResponse.json({
                success: true,
                reply: mirror.reply,
                replyCount: mirror.replyCount,
                source: "lens",
              });
              await notifyPostReplied({
                postId,
                replyId: mirror.reply.id,
                actorAddress,
                accessToken: retryTokens.accessToken,
              });
              applyRefreshedCookies(successResponse, retryTokens);
              return successResponse;
            } catch (retryError) {
              message =
                retryError instanceof Error ? retryError.message : message;
            }
          }
        }
        logger.warn("posts.replies.mutation_lens_failed", { error: message });
        return NextResponse.json(
          {
            error: `Lens reply failed: ${message}. Reply was not published to Lens.`,
            source: "lens",
          },
          { status: isUnauthenticated ? 401 : 502 }
        );
      }
    }

    const result = await createReply({
      postId,
      address: actorAddress,
      content: parsedContent.content,
      username,
    });
    await notifyPostReplied({
      postId,
      replyId: result.reply.id,
      actorAddress,
    });

    return NextResponse.json({
      success: true,
      reply: result.reply,
      replyCount: result.replyCount,
      source: "local",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create reply";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
