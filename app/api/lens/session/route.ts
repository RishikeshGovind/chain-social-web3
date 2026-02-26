//app/api/lens/session/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";

type RefreshResponse = {
  refresh: {
    accessToken?: string;
    refreshToken?: string;
    reason?: string;
  };
};

// Check if user has a valid Lens session
// We just check if cookies exist - the actual API calls will validate them
export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("lensAccessToken")?.value;
    const refreshToken = cookieStore.get("lensRefreshToken")?.value;

    console.log("[Session] Checking cookies - accessToken exists:", !!accessToken, "refreshToken exists:", !!refreshToken);

    if (!accessToken) {
      if (!refreshToken) {
        return NextResponse.json({ authenticated: false, reason: "no_access_token" });
      }

      try {
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

        const refreshedAccess = data.refresh?.accessToken;
        const refreshedRefresh = data.refresh?.refreshToken;
        if (!refreshedAccess || !refreshedRefresh) {
          return NextResponse.json({
            authenticated: false,
            reason: data.refresh?.reason || "refresh_failed",
          });
        }

        const response = NextResponse.json({
          authenticated: true,
          hasRefreshToken: true,
          refreshed: true,
        });
        const secure = process.env.NODE_ENV === "production";
        response.cookies.set("lensAccessToken", refreshedAccess, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24,
        });
        response.cookies.set("lensRefreshToken", refreshedRefresh, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
        return response;
      } catch (refreshError) {
        const reason =
          refreshError instanceof Error ? refreshError.message : "refresh_exception";
        return NextResponse.json({
          authenticated: true,
          hasRefreshToken: true,
          degraded: true,
          reason,
        });
      }
    }

    // Just check if the token exists and is not empty
    // The actual API requests will validate if it's expired
    return NextResponse.json({
      authenticated: true,
      hasRefreshToken: !!refreshToken,
    });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json({ authenticated: false, reason: "error" });
  }
}

// Logout - clear Lens cookies
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  
  response.cookies.delete("lensAccessToken");
  response.cookies.delete("lensRefreshToken");
  
  return response;
}
