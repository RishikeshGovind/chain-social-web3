import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { challengeId, signature } = await req.json();

    const query = `
      mutation Authenticate($request: SignedAuthChallenge!) {
        authenticate(request: $request) {
          ... on AuthenticationTokens {
            accessToken
            refreshToken
          }
        }
      }
    `;

    const data = await lensRequest(query, {
    request: {
        id: challengeId,
        signature: signature.signature, 
    },
    });


    const tokens = data.authenticate;
    console.log("Incoming signature:", signature);


    if (!tokens?.accessToken) {
      throw new Error("Authentication failed");
    }

    const cookieStore = cookies();

    cookieStore.set("lensAccessToken", tokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });

    cookieStore.set("lensRefreshToken", tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Lens authenticate error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
