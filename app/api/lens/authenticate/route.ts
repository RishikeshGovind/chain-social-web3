import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { id, signature } = await req.json();

    const authMutation = `
      mutation Authenticate($request: SignedAuthChallenge!) {
        authenticate(request: $request) {
          accessToken
          refreshToken
        }
      }
    `;

    const authData = await lensRequest(authMutation, {
      request: {
        id,
        signature,
      },
    });

    const { accessToken, refreshToken } = authData.authenticate;

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
