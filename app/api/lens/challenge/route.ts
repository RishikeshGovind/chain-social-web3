import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { address } = await req.json();

    const challengeQuery = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          id
          text
        }
      }
    `;

    const data = await lensRequest(challengeQuery, {
      request: {
        accountOwner: {
          app: process.env.LENS_APP_ADDRESS,
          account: address,
          owner: address,
        },
      },
    });

    return NextResponse.json(data.challenge);
  } catch (error: any) {
    console.error("Lens challenge error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
