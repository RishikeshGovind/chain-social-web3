//app/api/lens/refresh/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";
import { logger } from "@/lib/server/logger";

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

    logger.debug("lens.refresh.start");

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
      logger.warn("lens.refresh.failed", { reason });
      return NextResponse.json({ error: reason }, { status: 401 });
    }

    logger.info("lens.refresh.succeeded");

    const response = NextResponse.json({ success: true });
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set("lensAccessToken", result.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });

    response.cookies.set("lensRefreshToken", result.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    logger.error("lens.refresh.error", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
