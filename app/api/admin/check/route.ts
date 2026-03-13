import { NextRequest, NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";

function getAdminAddresses(): Set<string> {
  return new Set(
    (process.env.CHAINSOCIAL_ADMIN_ADDRESSES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => normalizeAddress(v))
  );
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address || !isValidAddress(address)) {
    return NextResponse.json({ isAdmin: false });
  }
  const allowed = getAdminAddresses();
  return NextResponse.json({ isAdmin: allowed.has(normalizeAddress(address)) });
}
