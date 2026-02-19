import { NextResponse } from "next/server";
import axios from "axios";

const LENS_API_URL = "https://api.lens.xyz/graphql";

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

  const response = await axios.post(
    LENS_API_URL,
    { query },
    { headers: { "Content-Type": "application/json" } }
  );

  return NextResponse.json(response.data);
}
