import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { recordDocumentVisit } from "@/lib/saas/product";
import { limitPublicRequests } from "@/lib/erp/store";
import { assertOrigin } from "@/lib/assistant/http";
export async function POST(req: NextRequest, c: { params: Promise<{ token: string }> }) {
  try {
    assertOrigin(req);
    const { token } = await c.params; await limitPublicRequests(`visit:${token}`, 500);
    const old = req.cookies.get("detali-visitor")?.value; const visitor = old && /^[a-f0-9]{48}$/.test(old) ? old : randomBytes(24).toString("hex");
    const result = await recordDocumentVisit(token, visitor, req.headers.get("user-agent") ?? "", req.headers.get("purpose") ?? req.headers.get("sec-purpose") ?? "");
    const response = NextResponse.json(result); response.cookies.set("detali-visitor", visitor, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 86400 * 30, path: "/" }); return response;
  } catch (e) { return jsonError(e); }
}
