//app/api/lens/auth/route.ts

import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type AuthChallengeResponse = {
  challenge: {
    id: string;
    text: string;
  };
};

export async function POST(req: Request) {
  try {
    const { address } = await req.json();

    if (typeof address !== "string" || !address) {
      return NextResponse.json(
        { error: "Wallet address required" },
        { status: 400 }
      );
    }

    const query = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          id
          text
        }
      }
    `;

    const data = await lensRequest<AuthChallengeResponse>(query, {
      request: {
        onboardingUser: {
          wallet: address
        }
      },
    });

    console.log("Lens challenge response:", data);

    return NextResponse.json({
      challenge: data.challenge,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens auth error";
    console.error("Lens auth error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
