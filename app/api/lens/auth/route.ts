import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { address } = await req.json();

    if (!address) {
      return NextResponse.json(
        { error: "Wallet address required" },
        { status: 400 }
      );
    }

    const query = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          text
        }
      }
    `;

    const data = await lensRequest(query, {
      request: {
        onboardingUser: {
          wallet: address
        }
      },
    });

    console.log("Lens challenge response:", data);

    return NextResponse.json({
      challenge: data.challenge.text,
    });
  } catch (error: any) {
    console.error("Lens auth error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
