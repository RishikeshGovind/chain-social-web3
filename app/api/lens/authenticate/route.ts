import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { address, signature } = await req.json();

    const query = `
      mutation Authenticate($request: AuthenticateRequest!) {
        authenticate(request: $request) {
          accessToken
          refreshToken
        }
      }
    `;

    const data = await lensRequest(query, {
      request: {
        onboardingUser: {
          wallet: address,
        },
        signature,
      },
    });

    const { accessToken, refreshToken } = data.authenticate;

    const response = NextResponse.json({ success: true });

    response.cookies.set("lensAccessToken", accessToken, {
      httpOnly: true,
      secure: false,
      path: "/",
    });

    response.cookies.set("lensRefreshToken", refreshToken, {
      httpOnly: true,
      secure: false,
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("Lens authenticate error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
