import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";
import { createLensPost } from "@/lib/lens/writes";
import {
  enqueueLegacyPostsForMigration,
  listLegacyLocalPosts,
  listPostOutbox,
  markPostOutboxFailed,
  markPostOutboxProcessing,
  markPostOutboxPublished,
} from "@/lib/posts/store";
import { isValidAddress, parseAndValidateContent } from "@/lib/posts/content";
import { validateMediaUrls } from "@/lib/posts/validation";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";
import {
  evaluateTextSafety,
  isAddressBanned,
  isMediaBlockedOrQuarantined,
} from "@/lib/server/moderation/store";

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

export async function GET(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "100", 10);

    const [legacyPosts, outbox] = await Promise.all([
      listLegacyLocalPosts({ address: actorAddress, limit }),
      listPostOutbox({ address: actorAddress }),
    ]);

    return NextResponse.json({
      actorAddress,
      legacyPosts,
      outbox,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load migration status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "enqueue";
    const limitRaw = Number.parseInt(String(body?.limit ?? "25"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;

    if (action === "enqueue") {
      const result = await enqueueLegacyPostsForMigration({
        address: actorAddress,
        limit,
      });
      const outbox = await listPostOutbox({ address: actorAddress });
      return NextResponse.json({
        action,
        actorAddress,
        ...result,
        outbox,
      });
    }

    if (action === "process") {
      const accessToken = await getLensAccessTokenFromCookie();
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens before migration." },
          { status: 401 }
        );
      }

      const lensAccountAddress = (await getLensAccountAddress(actorAddress)) ?? actorAddress;
      const candidates = (await listPostOutbox({
        address: actorAddress,
        statuses: ["pending", "failed"],
      })).slice(0, limit);

      let published = 0;
      let failed = 0;
      let skipped = 0;

      if (await isAddressBanned(actorAddress)) {
        return NextResponse.json(
          { error: "Your account is restricted from publishing." },
          { status: 403 }
        );
      }

      for (const item of candidates) {
        await markPostOutboxProcessing(item.id);
        try {
          // Re-run current moderation checks on legacy content
          const contentCheck = parseAndValidateContent(item.content);
          if (!contentCheck.ok) {
            await markPostOutboxFailed(item.id, `Content rejected: ${contentCheck.error}`);
            skipped += 1;
            continue;
          }

          const safety = await evaluateTextSafety({
            text: contentCheck.content,
            address: actorAddress,
            type: "post",
          });
          if (safety.decision === "block" || safety.decision === "review") {
            await markPostOutboxFailed(
              item.id,
              safety.reasons[0] ?? "Blocked by current safety rules."
            );
            skipped += 1;
            continue;
          }

          if (item.media && item.media.length > 0) {
            const mediaCheck = validateMediaUrls(item.media);
            if (!mediaCheck.ok) {
              await markPostOutboxFailed(item.id, `Media rejected: ${mediaCheck.error}`);
              skipped += 1;
              continue;
            }
            let mediaBlocked = false;
            for (const url of mediaCheck.urls) {
              if (await isMediaBlockedOrQuarantined(url)) {
                mediaBlocked = true;
                break;
              }
            }
            if (mediaBlocked) {
              await markPostOutboxFailed(item.id, "Media blocked or pending review.");
              skipped += 1;
              continue;
            }
          }

          const post = await createLensPost({
            content: item.content,
            media: item.media,
            actorAddress: lensAccountAddress,
            accessToken,
          });
          await markPostOutboxPublished(item.id, post.id);
          published += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Migration publish failed";
          await markPostOutboxFailed(item.id, message);
          failed += 1;
        }
      }

      const outbox = await listPostOutbox({ address: actorAddress });
      const legacyPosts = await listLegacyLocalPosts({ address: actorAddress, limit: 100 });
      return NextResponse.json({
        action,
        actorAddress,
        lensAccountAddress,
        attempted: candidates.length,
        published,
        failed,
        skipped,
        remainingLegacy: legacyPosts.length,
        outbox,
      });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
