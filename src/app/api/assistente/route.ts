import { NextRequest } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { assistantChat } from "@/lib/assistant/runtime";
import { ownHistory } from "@/lib/assistant/data";
import { executeAction, visibleHelp } from "@/lib/assistant/tools";
import { aiConfig } from "@/lib/assistant/config";
import { aiActions } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { readJson } from "@/lib/assistant/http";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function GET(req: NextRequest) { return handle(async () => {
  const { user } = await requireSession(); const c = await aiConfig(user.companyId); const id = req.nextUrl.searchParams.get("threadId");
  const history = id ? await ownHistory(user, id) : { messages: [], thread: null };
  const actions = id ? await db.select().from(aiActions).where(and(eq(aiActions.threadId, id), eq(aiActions.userId, user.id), eq(aiActions.companyId, user.companyId))).orderBy(desc(aiActions.createdAt)).limit(20) : [];
  return { ...history, actions, articles: visibleHelp(user), aiReady: !!(c.preferences.model && c.secrets.aiKey) };
}); }
export async function POST(req: NextRequest) { return handle(async () => {
  const { user } = await requireSession(); const data = await readJson(req);
  if (data.action === "confirm") {
    const p = z.object({ action: z.literal("confirm"), id: z.string().uuid(), confirm: z.boolean() }).strict().parse(data);
    return executeAction(user, p.id, p.confirm);
  }
  const message = { ...data }; delete message.action; return assistantChat(user, message);
}); }
