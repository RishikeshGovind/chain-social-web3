import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { address } = await req.json();

    const query = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          id
          text
        }
      }
    `;

    const data = await lensRequest(query, {
      request: {
        onboardingUser: {
          wallet: address,
        },
      },
    });

    return NextResponse.json({
      challengeId: data.challenge.id,
      challengeText: data.challenge.text,
    });
  } catch (error: any) {
    console.error("Lens auth error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
