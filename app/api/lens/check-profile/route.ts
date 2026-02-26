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
    // Using accountsAvailable query which is the correct v2/v3 endpoint
    // Include both owned and managed accounts
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
          includeOwned: true,
        },
      }
    );

    // the GraphQL response shape is dynamic; casting here avoids TypeScript
    // diagnostics while the eslint rule complains about `any`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiles = (data as any)?.accountsAvailable?.items ?? [];
    const hasProfile = profiles.length > 0;
    
    // Extract the first account address if available
    const accountAddress = profiles.length > 0 
      ? profiles[0]?.account?.address ?? null 
      : null;

    return NextResponse.json({
      hasProfile,
      accountAddress,
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
