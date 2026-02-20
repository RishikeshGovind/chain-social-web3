import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

type AccountsResponse = {
  accountsAvailable: {
    items: unknown[];
  };
};

export async function POST(req: Request) {
  try {
    const { wallet } = await req.json();
    if (typeof wallet !== "string") {
      return NextResponse.json({ error: "Invalid wallet payload" }, { status: 400 });
    }

    const query = `
      query Accounts($request: AccountsAvailableRequest!) {
        accountsAvailable(request: $request) {
          items {
            __typename
            ... on AccountOwned {
              account {
                address
                username {
                  localName
                }
              }
            }
            ... on AccountManaged {
              account {
                address
                username {
                  localName
                }
              }
            }
          }
        }
      }
    `;

    const data = await lensRequest<AccountsResponse>(query, {
      request: {
        managedBy: wallet
      }
    });

    return NextResponse.json(data.accountsAvailable.items);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch accounts";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
