import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export async function POST(req: Request) {
  try {
    const { wallet } = await req.json();

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

    const data = await lensRequest(query, {
      request: {
        managedBy: wallet
      }
    });

    return NextResponse.json(data.accountsAvailable.items);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
