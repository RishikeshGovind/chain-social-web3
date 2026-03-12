import { NextRequest, NextResponse } from "next/server";
import {
  evaluateCompliance,
  getCompliancePolicy,
  getRequestCountry,
} from "@/lib/server/compliance/policy";

// Maximum allowed request body size (10MB)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Enforce request body size limits for POST/PUT/PATCH requests
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: "Request body too large", maxSize: MAX_BODY_SIZE },
        { status: 413 }
      );
    }
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
  matcher: [
    // Match all routes EXCEPT static files, Next.js internals, and images
    "/((?!_next/static|_next/image|favicon|public/|uploads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
