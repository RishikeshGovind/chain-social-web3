//app/api/lens/authenticate/route.ts

import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type AuthenticateResult = {
  __typename?: string;
  accessToken?: string;
  refreshToken?: string;
  reason?: string;
  error?: string;
  message?: string;
};

type AuthenticateResponse = {
  authenticate: AuthenticateResult;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawId = body?.id;
    const id =
      typeof rawId === "string"
        ? rawId
        : typeof rawId === "number"
          ? String(rawId)
          : rawId === null || rawId === undefined
            ? undefined
            : null;
    const rawSignature = body?.signature;
    const signature =
      typeof rawSignature === "string"
        ? rawSignature
        : rawSignature && typeof rawSignature === "object" && typeof rawSignature.signature === "string"
          ? rawSignature.signature
          : null;
    const address = body?.address;

    if (id === null || !signature) {
      return NextResponse.json({ error: "Invalid authentication payload" }, { status: 400 });
    }
    if (typeof address !== "string") {
      return NextResponse.json({ error: "Invalid address payload" }, { status: 400 });
    }

    const authMutationWithFragments = `
      mutation Authenticate($request: SignedAuthChallenge!) {
        authenticate(request: $request) {
          __typename
          ... on AuthenticationTokens {
            accessToken
            refreshToken
          }
          ... on WrongSignerError {
            reason
          }
          ... on ForbiddenError {
            reason
          }
        }
      }
    `;

    const authMutationDirectWithFragments = `
      mutation Authenticate($address: EvmAddress!, $signature: Signature!) {
        authenticate(address: $address, signature: $signature) {
          __typename
          ... on AuthenticationTokens {
            accessToken
            refreshToken
          }
          ... on WrongSignerError {
            reason
          }
          ... on ForbiddenError {
            reason
          }
        }
      }
    `;

    const errors: string[] = [];
    let authData: AuthenticateResponse | null = null;

    const variants: Array<{ query: string; variables: Record<string, unknown> }> = [
      {
        query: authMutationWithFragments,
        variables: {
          request: {
            ...(typeof id === "string" ? { id } : {}),
            signature,
          },
        },
      },
      {
        query: authMutationWithFragments,
        variables: {
          request: {
            signature,
            signedBy: address,
            ...(typeof id === "string" ? { challengeId: id } : {}),
          },
        },
      },
      {
        query: authMutationDirectWithFragments,
        variables: {
          address,
          signature,
        },
      },
    ];

    for (const variant of variants) {
      try {
        const result = await lensRequest<AuthenticateResponse>(variant.query, variant.variables);
        if (result.authenticate?.accessToken) {
          authData = result;
          break;
        }
        if (result.authenticate?.reason) {
          errors.push(result.authenticate.reason);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "authenticate variant failed");
      }
    }

    if (!authData) {
      throw new Error(errors.join(" | "));
    }

    const { accessToken, refreshToken } = authData.authenticate;
    if (!accessToken || !refreshToken) {
      throw new Error("Lens authenticate did not return tokens");
    }

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
