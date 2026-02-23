import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { address } = await req.json();

    if (!address) {
      return NextResponse.json(
        { error: "Address required" },
        { status: 400 }
      );
    }

    // Query Lens API for accounts/profiles available for this wallet
    // Using accountsAvailable query which is the correct v2 endpoint
    const data = await lensRequest(
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
          managedBy: address,
        },
      }
    );

    const profiles = (data as any)?.accountsAvailable?.items ?? [];
    const hasProfile = profiles.length > 0;

    return NextResponse.json({
      hasProfile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile check failed";
    console.error("Profile check error:", message, error);
    // Fallback to false on error but log it
    return NextResponse.json(
      { hasProfile: false },
      { status: 200 } // Return 200 so client doesn't error out
    );
  }
}
