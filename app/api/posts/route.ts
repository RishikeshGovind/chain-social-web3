import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/posts/rate-limit";
import {
  isValidAddress,
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
        const repostMap = await getRepostsForPosts((lensData.posts ?? []).map((post) => post.id));
        const postsWithReposts = (lensData.posts ?? []).map((post) => ({
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
        const localData = await listPosts({
          limit: boundedLimit,
          cursor,
          author,
        });
        return NextResponse.json({
          ...localData,
          source: "local",
          resolvedAuthor: author ?? null,
          lensFallbackError: lensMessage,
        });
      }
    }

    const localData = await listPosts({
      limit: boundedLimit,
      cursor,
      author,
    });

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

    const rateLimit = checkPostRateLimit(actorAddress);
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

    if (useLensData) {
      const accessToken = await getLensAccessTokenFromCookie();
      console.log("[Post API] Has access token:", !!accessToken);
      console.log("[Post API] Access token preview:", accessToken ? `${accessToken.slice(0, 20)}...` : "none");
      
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
        // when Lens indexing/session is delayed.
        try {
          await createPost({
            address: lensAccountAddress,
            content: parsedContent.content,
            username,
            media,
          });
        } catch (mirrorError) {
          console.warn("[Post API] Local mirror write failed:", mirrorError);
        }
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
    });

    return NextResponse.json({ success: true, post, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
