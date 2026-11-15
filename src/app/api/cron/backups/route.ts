import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { companySettings, companies, memberships, users, backupRuns } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { handle } from "@/lib/api/http";
import { createBackup } from "@/lib/erp/backup";
import { fail, localDay } from "@/lib/erp/common";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) fail("Agendador aguardando configuração", 503);
    const supplied = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail("Não autorizado", 401);
    const settings = await db.select({ companyId: companySettings.companyId, preferences: companySettings.preferences, timezone: companies.timezone, name: companies.name })
      .from(companySettings).innerJoin(companies, eq(companies.id, companySettings.companyId));
    const results: { companyId: string; status: string; id?: string }[] = [];
    for (const setting of settings) {
      if (!setting.preferences.backupEnabled) continue;
      const now = new Date(); const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: setting.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
      if (hour < (setting.preferences.backupHour ?? 3)) continue;
      const [last] = await db.select().from(backupRuns).where(and(eq(backupRuns.companyId, setting.companyId), eq(backupRuns.status, "concluido"))).orderBy(desc(backupRuns.createdAt)).limit(1);
      if (last && localDay(setting.timezone, last.createdAt) === localDay(setting.timezone)) continue;
      const [manager] = await db.select({ id: users.id, name: users.name, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.companyId, setting.companyId), eq(memberships.role, "gestor"), eq(users.active, true))).limit(1);
      if (!manager) { results.push({ companyId: setting.companyId, status: "sem_gestor_ativo" }); continue; }
      try { const result = await createBackup({ ...manager, companyId: setting.companyId, companyName: setting.name, role: "gestor", timezone: setting.timezone }); results.push({ companyId: setting.companyId, status: "concluido", id: result.id }); }
      catch { results.push({ companyId: setting.companyId, status: "falha" }); }
    }
    return { results };
  });
}
