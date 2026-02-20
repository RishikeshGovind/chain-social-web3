import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type ChallengeResponse = {
  challenge: {
    id: string;
    text: string;
  };
};

export async function POST(req: Request) {
  try {
    const { address } = await req.json();
    if (typeof address !== "string") {
      return NextResponse.json({ error: "Invalid address payload" }, { status: 400 });
    }

    const challengeQuery = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          id
          text
        }
      }
    `;

    const data = await lensRequest<ChallengeResponse>(challengeQuery, {
      request: {
        accountOwner: {
          app: process.env.LENS_APP_ADDRESS,
          account: address,
          owner: address,
        },
      },
    });

    return NextResponse.json(data.challenge);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens challenge error";
    console.error("Lens challenge error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
