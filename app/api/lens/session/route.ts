//app/api/lens/session/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// Check if user has a valid Lens session
// We just check if cookies exist - the actual API calls will validate them
export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("lensAccessToken")?.value;
    const refreshToken = cookieStore.get("lensRefreshToken")?.value;

    console.log("[Session] Checking cookies - accessToken exists:", !!accessToken, "refreshToken exists:", !!refreshToken);

    if (!accessToken) {
      return NextResponse.json({ authenticated: false, reason: "no_access_token" });
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
