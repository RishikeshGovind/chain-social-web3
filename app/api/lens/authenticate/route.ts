import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type AuthenticateResponse = {
  authenticate: {
    accessToken: string;
    refreshToken: string;
  };
};

export async function POST(req: Request) {
  try {
    const { id, signature } = await req.json();
    if (typeof id !== "string" || typeof signature !== "string") {
      return NextResponse.json({ error: "Invalid authentication payload" }, { status: 400 });
    }

    const authMutation = `
      mutation Authenticate($request: SignedAuthChallenge!) {
        authenticate(request: $request) {
          accessToken
          refreshToken
        }
      }
    `;

    const authData = await lensRequest<AuthenticateResponse>(authMutation, {
      request: {
        id,
        signature,
      },
    });

    const { accessToken, refreshToken } = authData.authenticate;

    const response = NextResponse.json({ success: true });
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set("lensAccessToken", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    response.cookies.set("lensRefreshToken", refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens authenticate error";
    console.error("Lens authenticate error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
