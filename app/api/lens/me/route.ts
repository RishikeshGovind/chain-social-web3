// app/api/lens/me/route.ts

import { NextResponse } from "next/server";
import { lensRequest } from "@/lib/lens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const query = `
    query {
      __type(name: "SignedAuthChallenge") {
        name
        inputFields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  `;

  try {
    const data = await lensRequest(query);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
