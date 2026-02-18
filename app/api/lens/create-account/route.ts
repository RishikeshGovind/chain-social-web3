import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";

export async function POST() {
  try {
    const cookieStore = cookies();
    const accessToken = cookieStore.get("lensAccessToken")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated with Lens" },
        { status: 401 }
      );
    }

    const mutation = `
      mutation CreateAccount($request: CreateAccountRequest!) {
        createAccount(request: $request) {
          ... on CreateAccountResponse {
            hash
          }
          ... on RelayError {
            reason
          }
        }
      }
    `;

    const data = await lensRequest(
      mutation,
      {
        request: {
          metadataUri: "ipfs://bafkreighdummyexamplemetadatauri",
        },
      },
      accessToken
    );

    return NextResponse.json(data.createAccount);
  } catch (error: any) {
    console.error("Create account error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
