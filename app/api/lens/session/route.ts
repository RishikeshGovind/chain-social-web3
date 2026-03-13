//app/api/lens/session/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";
import { logger } from "@/lib/server/logger";
import {
  getActorAddressFromLensToken,
  isTokenExpired,
} from "@/lib/server/auth/lens-actor";

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
    let accessToken = cookieStore.get("lensAccessToken")?.value ?? null;
    let refreshToken = cookieStore.get("lensRefreshToken")?.value ?? null;
    let refreshed = false;

    logger.debug("lens.session.check", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
    });

    const refreshIfPossible = async () => {
      if (!refreshToken) {
        return null;
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
          return {
            ok: false as const,
            reason: data.refresh?.reason || "refresh_failed",
          };
        }

        accessToken = refreshedAccess;
        refreshToken = refreshedRefresh;
        refreshed = true;
        return { ok: true as const };
      } catch (refreshError) {
        const reason =
          refreshError instanceof Error ? refreshError.message : "refresh_exception";
        return { ok: false as const, reason };
      }
    };

    if (!accessToken || isTokenExpired(accessToken)) {
      const refreshResult = await refreshIfPossible();
      if (!refreshResult?.ok) {
        return NextResponse.json({
          authenticated: false,
          hasRefreshToken: !!refreshToken,
          reason: refreshResult?.reason || "no_access_token",
        });
      }
    }

    let actorAddress = accessToken
      ? await getActorAddressFromLensToken(accessToken)
      : null;

    // Token may still be stale from actor perspective; refresh once.
    if (!actorAddress && !refreshed) {
      const refreshResult = await refreshIfPossible();
      if (refreshResult?.ok && accessToken) {
        actorAddress = await getActorAddressFromLensToken(accessToken);
      }
    }

    if (!actorAddress) {
      return NextResponse.json({
        authenticated: false,
        hasRefreshToken: !!refreshToken,
        reason: "actor_unresolved",
      });
    }

    const response = NextResponse.json({
      authenticated: true,
      hasRefreshToken: !!refreshToken,
      actorAddress,
      refreshed,
    });
    if (refreshed && accessToken && refreshToken) {
      const secure = process.env.NODE_ENV === "production";
      response.cookies.set("lensAccessToken", accessToken, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24,
      });
      response.cookies.set("lensRefreshToken", refreshToken, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  } catch (error) {
    logger.error("lens.session.error", { error });
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
