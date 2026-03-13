import { NextResponse } from "next/server";
import { getAdminOperator } from "@/lib/server/compliance/operator-auth";
import { clearAutoQuarantineReports } from "@/lib/server/moderation/store";

export async function POST(req: Request) {
  const operator = await getAdminOperator(req.headers);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await clearAutoQuarantineReports();
  return NextResponse.json({ success: true, ...result });
}
