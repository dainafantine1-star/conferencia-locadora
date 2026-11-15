import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { readJson } from "@/lib/assistant/http";
import { configurationData, saveConfiguration } from "@/lib/assistant/config";
import { agentsData, saveAgent, rulesData, saveRule, inboxData, updateThread } from "@/lib/assistant/data";
import { knowledgeData, saveKnowledge } from "@/lib/assistant/knowledge";
import { connectionStatus, sendWhatsApp } from "@/lib/assistant/channels";
import { runCompanyJobs, cleanupHistory } from "@/lib/assistant/worker";
import { testAgent } from "@/lib/assistant/runtime";
import { fail } from "@/lib/erp/common";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ module: string }> };
export async function GET(req: NextRequest, ctx: Context) { return handle(async () => {
  const { user } = await requireSession(); const { module } = await ctx.params;
  switch (module) {
    case "configuracoes": return configurationData(user);
    case "agentes": return agentsData(user);
    case "conhecimento": return knowledgeData(user);
    case "automacoes": return rulesData(user);
    case "conversas": return inboxData(user, req.nextUrl.searchParams.get("threadId") ?? undefined);
    default: fail("Módulo de atendimento não encontrado", 404);
  }
}); }
export async function POST(req: NextRequest, ctx: Context) { return handle(async () => {
  const { user } = await requireSession(); const { module } = await ctx.params; const body = await readJson(req); const { action, ...data } = body;
  switch (module) {
    case "configuracoes": return action === "status" ? connectionStatus(user) : action === "connect" ? connectionStatus(user, true) : saveConfiguration(user, data);
    case "agentes": return action === "test" ? testAgent(user, z.string().uuid().parse(data.id), z.string().min(1).max(3000).parse(data.text)) : saveAgent(user, data);
    case "conhecimento": return saveKnowledge(user, data);
    case "automacoes": return action === "run" ? runCompanyJobs(user) : action === "cleanup" ? cleanupHistory(user) : saveRule(user, body);
    case "conversas": return action === "send" ? sendWhatsApp(user, data) : updateThread(user, data);
    default: fail("Módulo de atendimento não encontrado", 404);
  }
}); }
