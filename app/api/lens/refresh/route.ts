//app/api/lens/refresh/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";

type RefreshResponse = {
  refresh: {
    __typename?: string;
    accessToken?: string;
    refreshToken?: string;
    reason?: string;
  };
};

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get("lensRefreshToken")?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { error: "No refresh token available" },
        { status: 401 }
      );
    }

    console.log("[Lens Refresh] Attempting token refresh...");

    const data = await lensRequest<RefreshResponse>(
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

    const result = data.refresh;
    
    if (!result?.accessToken || !result?.refreshToken) {
      const reason = result?.reason || "Token refresh failed";
      console.error("[Lens Refresh] Failed:", reason);
      return NextResponse.json({ error: reason }, { status: 401 });
    }

    console.log("[Lens Refresh] Got new tokens, updating cookies...");

    const response = NextResponse.json({ success: true });
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set("lensAccessToken", result.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });

    response.cookies.set("lensRefreshToken", result.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    console.error("[Lens Refresh] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
