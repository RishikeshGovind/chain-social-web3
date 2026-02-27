import { NextResponse } from "next/server";
import { checkReplyRateLimit } from "@/lib/posts/rate-limit";
import { isValidAddress, parseAndValidateContent } from "@/lib/posts/content";
import { createReply, listReplies, upsertReply } from "@/lib/posts/store";
import { createLensReply } from "@/lib/lens/writes";
import { lensRequest } from "@/lib/lens";
import { fetchLensReplies } from "@/lib/lens/feed";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
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
    const boundedLimit = Number.isNaN(limit) ? 20 : limit;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      try {
        const accessToken = await getLensAccessTokenFromCookie();
        const lensData = await fetchLensReplies({
          postId,
          limit: boundedLimit,
          cursor,
          accessToken: accessToken ?? undefined,
        });
        const localData = await listReplies({
          postId,
          limit: boundedLimit,
          cursor,
        });
        const merged = [...(lensData.replies ?? []), ...(localData.replies ?? [])]
          .sort((a, b) => {
            const timeDelta = toTimestampMs(b.timestamp) - toTimestampMs(a.timestamp);
            if (timeDelta !== 0) return timeDelta;
            return b.id.localeCompare(a.id);
          })
          .filter((reply, index, arr) => arr.findIndex((r) => r.id === reply.id) === index)
          .slice(0, boundedLimit);
        return NextResponse.json({
          replies: merged,
          nextCursor: lensData.nextCursor ?? localData.nextCursor ?? null,
          source: "lens",
        });
      } catch (lensError) {
        const message =
          lensError instanceof Error ? lensError.message : "unknown error";
        console.warn(
          "Lens replies fetch failed, falling back to local store:",
          message
        );
      }
    }

    const data = await listReplies({
      postId,
      limit: boundedLimit,
      cursor,
    });

    return NextResponse.json(data);
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

    const rateLimit = checkReplyRateLimit(actorAddress);
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

    const username =
      typeof body?.author?.username?.localName === "string"
        ? body.author.username.localName.trim().slice(0, 32)
        : undefined;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      const accessToken = await getLensAccessTokenFromCookie();
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens." },
          { status: 401 }
        );
      }

      try {
        const lensAccountAddress =
          (await getLensAccountAddress(actorAddress)) ?? actorAddress;
        const reply = await createLensReply({
          postId,
          content: parsedContent.content,
          actorAddress: lensAccountAddress,
          accessToken,
        });
        const mirror = await upsertReply({
          id: reply.id,
          postId,
          address: lensAccountAddress,
          content: parsedContent.content,
          username,
          timestamp: reply.timestamp,
        });
        return NextResponse.json({
          success: true,
          reply: mirror.reply,
          replyCount: mirror.replyCount,
          source: "lens",
        });
      } catch (lensError) {
        const message =
          lensError instanceof Error ? lensError.message : "unknown error";
        console.warn(
          "Lens reply mutation failed:",
          message
        );
        const isUnauthenticated =
          message.toLowerCase().includes("unauthenticated") ||
          message.toLowerCase().includes("authentication is required");
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
