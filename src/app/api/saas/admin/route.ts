import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { platformData, savePlan, assignSubscription, answerSupport } from "@/lib/saas/platform";
import { fail } from "@/lib/erp/common";
export async function GET() { return handle(async () => platformData((await requireSession()).user)); }
export async function POST(req: NextRequest) { return handle(async () => { const { user } = await requireSession(); const body = await readJson(req, 100000); if (body.action === "plan") return savePlan(user, body); if (body.action === "subscription") return assignSubscription(user, body); if (body.action === "support") return answerSupport(user, body); fail("Ação desconhecida", 400); }); }
