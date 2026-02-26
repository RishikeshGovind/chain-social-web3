//app/api/lens/auth/route.ts

import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type AuthChallengeResponse = {
  challenge: {
    id: string;
    text: string;
  };
};

type AccountsAvailableResponse = {
  accountsAvailable: {
    items: Array<{
      __typename: string;
      account?: { address: string };
    }>;
  };
};

async function getUserLensAccount(walletAddress: string): Promise<string | null> {
  try {
    const data = await lensRequest<AccountsAvailableResponse>(
      `
        query AccountsAvailable($request: AccountsAvailableRequest!) {
          accountsAvailable(request: $request) {
            items {
              __typename
              ... on AccountOwned {
                account {
                  address
                }
              }
              ... on AccountManaged {
                account {
                  address
                }
              }
            }
          }
        }
      `,
      {
        request: {
          managedBy: walletAddress,
          includeOwned: true,
        },
      }
    );

    const items = data?.accountsAvailable?.items ?? [];
    // Prefer AccountOwned over AccountManaged
    const owned = items.find((i) => i.__typename === "AccountOwned");
    const managed = items.find((i) => i.__typename === "AccountManaged");
    const account = owned ?? managed;
    return account?.account?.address ?? null;
  } catch {
    return null;
  }
}

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

    // First, check if user has a Lens account (profile)
    const lensAccount = await getUserLensAccount(address);
    console.log("[Lens Auth] User Lens account:", lensAccount ?? "none (onboarding)");

    let challengeData: AuthChallengeResponse | null = null;
    const errors: string[] = [];

    // If user has a Lens account, use accountOwner challenge (for existing profiles)
    if (lensAccount) {
      const accountOwnerVariants = [
        {
          accountOwner: {
            account: lensAccount,
            owner: address,
            app: process.env.LENS_APP_ADDRESS || undefined,
          },
        },
        {
          accountOwner: {
            account: lensAccount,
            owner: address,
          },
        },
      ];

      for (const requestVariant of accountOwnerVariants) {
        try {
          const data = await lensRequest<AuthChallengeResponse>(query, {
            request: requestVariant,
          });
          if (data.challenge?.text) {
            challengeData = data;
            console.log("[Lens Auth] Got accountOwner challenge");
            break;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "challenge variant failed");
        }
      }
    }

    // Fallback to onboardingUser challenge if no account or accountOwner failed
    if (!challengeData) {
      try {
        const data = await lensRequest<AuthChallengeResponse>(query, {
          request: {
            onboardingUser: {
              wallet: address,
            },
          },
        });
        if (data.challenge?.text) {
          challengeData = data;
          console.log("[Lens Auth] Got onboardingUser challenge");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "onboarding challenge failed");
      }
    }

    if (!challengeData?.challenge) {
      throw new Error(errors.join(" | ") || "Could not get Lens challenge");
    }

    console.log("[Lens Auth] Challenge response:", challengeData);

    return NextResponse.json({
      challenge: challengeData.challenge,
      hasLensAccount: !!lensAccount,
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
