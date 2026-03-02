import { NextRequest, NextResponse } from "next/server";
import {
  evaluateCompliance,
  getCompliancePolicy,
  getRequestCountry,
} from "@/lib/server/compliance/policy";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip static and build assets.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public/")
  ) {
    return NextResponse.next();
  }

  const country = getRequestCountry(request.headers);
  const decision = evaluateCompliance({
    pathname,
    method: request.method,
    country,
    policy: getCompliancePolicy(),
  });

  if (!decision.allow) {
    return NextResponse.json(
      {
        error: decision.message,
        code: decision.code,
        country: decision.country,
      },
      {
        status: decision.status,
        headers: {
          "X-Chainsocial-Policy": decision.code,
          "X-Chainsocial-Country": decision.country,
        },
      }
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-Chainsocial-Country", country);
  return response;
}

export const config = {
  matcher: ["/:path*"],
};
