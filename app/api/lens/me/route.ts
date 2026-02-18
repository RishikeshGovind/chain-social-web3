import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lensRequest } from "@/lib/lens";

export async function GET() {
  try {
    const cookieStore = cookies();
    const accessToken = cookieStore.get("lensAccessToken")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated with Lens" },
        { status: 401 }
      );
    }

    const query = `
    query Me {
        me {
        __typename
        ... on Account {
            address
            username {
            localName
            }
        }
        ... on OnboardingUser {
            wallet
        }
        }
    }
    `;

    const data = await lensRequest(query, {}, accessToken);

    console.log("Lens me response:", data);

    return NextResponse.json(data.me);
  } catch (error: any) {
    console.error("Lens me error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
