import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/posts/rate-limit";
import {
  isValidAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { createPost, listPosts } from "@/lib/posts/store";
import { validateMediaUrls } from "@/lib/posts/validation";
import { fetchLensPosts } from "@/lib/lens/feed";
import { createLensPost } from "@/lib/lens/writes";
import { lensRequest } from "@/lib/lens";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10);
    const cursor = searchParams.get("cursor") ?? undefined;
    const author = searchParams.get("author") ?? undefined;
    const postId = searchParams.get("postId") ?? undefined;
    const debug = searchParams.get("debug") === "1";
    const debugSchema = searchParams.get("debugSchema") === "1";

    const boundedLimit = Number.isNaN(limit) ? 10 : limit;
    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      try {
        const accessToken = await getLensAccessTokenFromCookie();
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
          author,
          postId,
          debug,
          accessToken: accessToken ?? undefined,
        });
        return NextResponse.json({
          ...lensData,
          source: "lens",
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
          lensFallbackError: lensMessage,
        });
      }
    }

    const localData = await listPosts({
      limit: boundedLimit,
      cursor,
      author,
    });

    return NextResponse.json({ ...localData, source: "local" });
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
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens." },
          { status: 401 }
        );
      }

      // Fetch profileId for actorAddress using GraphQL
      let profileId = actorAddress; // Use address as fallback profileId
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profileRes = await lensRequest<any>(
          `query GetProfile($request: AccountsAvailableRequest!) {
            accountsAvailable(request: $request) {
              items {
                __typename
                ... on AccountOwned {
                  account {
                    address
                    username { localName }
                  }
                }
                ... on AccountManaged {
                  account {
                    address
                    username { localName }
                  }
                }
              }
            }
          }`,
          { request: { managedBy: actorAddress } },
          accessToken
        );
        // Use the address from the account
        const account = profileRes?.accountsAvailable?.items?.[0]?.account;
        if (account?.address) {
          profileId = account.address;
        } else if (account?.username?.localName) {
          profileId = `${actorAddress}/${account.username.localName}`;
        }
      } catch (profileError) {
        console.warn("Failed to fetch Lens profileId, using address as fallback:", profileError);
      }
      if (!profileId) {
        return NextResponse.json({ error: "Lens profile not found for address." }, { status: 400 });
      }

      try {
        const post = await createLensPost({
          content: parsedContent.content,
          actorAddress,
          accessToken,
          profileId,
          media,
        });
        return NextResponse.json({ success: true, post, source: "lens" });
      } catch (lensError) {
        console.warn(
          "Lens post mutation failed, falling back to local store:",
          lensError instanceof Error ? lensError.message : "unknown error"
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
