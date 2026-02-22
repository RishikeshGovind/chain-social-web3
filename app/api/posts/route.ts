import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/posts/rate-limit";
import {
  isValidAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { createPost, listPosts } from "@/lib/posts/store";
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
    let media = Array.isArray(body?.media) ? body.media.filter((url) => typeof url === "string") : undefined;
    // Basic backend validation for media URLs
    if (media && media.length > 0) {
      media = media.filter((url) => url.startsWith("http://") || url.startsWith("https://"));
      if (media.length > 4) {
        return NextResponse.json({ error: "Max 4 images per post." }, { status: 400 });
      }
      for (const url of media) {
        if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(url.split('?')[0])) {
          return NextResponse.json({ error: "Only image URLs are allowed." }, { status: 400 });
        }
      }
    }

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

      // Fetch profileId for actorAddress
      let profileId = undefined;
      try {
        const profileRes = await fetch(`${process.env.LENS_API_URL}/profiles?ownedBy=${actorAddress}`);
        const profileData = await profileRes.json();
        profileId = profileData?.data?.profiles?.items?.[0]?.id;
      } catch (profileError) {
        console.error("Failed to fetch Lens profileId:", profileError);
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
