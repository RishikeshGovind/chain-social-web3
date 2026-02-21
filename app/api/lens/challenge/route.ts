//app/api/lens/challenge/route.ts

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

    const challengeQueryWithId = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          id
          text
        }
      }
    `;

    const challengeQueryTextOnly = `
      mutation Challenge($request: ChallengeRequest!) {
        challenge(request: $request) {
          text
        }
      }
    `;

    const requestVariants: Array<Record<string, unknown>> = [
      {
        accountOwner: {
          app: process.env.LENS_APP_ADDRESS,
          account: address,
          owner: address,
        },
      },
      {
        onboardingUser: {
          wallet: address,
        },
      },
      {
        account: address,
      },
      {
        wallet: address,
      },
    ];

    const errors: string[] = [];
    for (const requestVariant of requestVariants) {
      try {
        const data = await lensRequest<ChallengeResponse>(challengeQueryWithId, {
          request: requestVariant,
        });

        if (data.challenge?.text) {
          return NextResponse.json({
            id: data.challenge.id ?? null,
            text: data.challenge.text,
          });
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "challenge variant failed");
      }

      try {
        const data = await lensRequest<{ challenge: { text: string } }>(challengeQueryTextOnly, {
          request: requestVariant,
        });
        if (data.challenge?.text) {
          return NextResponse.json({
            id: null,
            text: data.challenge.text,
          });
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "challenge variant failed");
      }
    }

    throw new Error(errors.join(" | "));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens challenge error";
    console.error("Lens challenge error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
