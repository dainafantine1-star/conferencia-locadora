import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { clientPortals, customers, companies, productRecords, messageLog, memberships, users } from "@/lib/db/schema";
import { integrationConfig } from "@/lib/erp/settings";
import { smtpTransport } from "@/lib/erp/integrations";
import { decrypt } from "@/lib/erp/crypto";
import { localDay } from "@/lib/erp/common";
import { assertFeature } from "./access";
import { portalData } from "./product";
import type { SessionUser } from "@/lib/auth/session";
export async function weeklyReports(now = new Date()) {
  const portals = await db.select({ portal: clientPortals, email: customers.email, name: customers.name, companyName: companies.name, timezone: companies.timezone }).from(clientPortals)
    .innerJoin(customers, and(eq(customers.id, clientPortals.customerId), eq(customers.companyId, clientPortals.companyId)))
    .innerJoin(companies, eq(companies.id, clientPortals.companyId)).where(and(eq(clientPortals.active, true), gt(clientPortals.expiresAt, now)));
  const results: { id: string; status: string }[] = [];
  for (const row of portals) {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: row.timezone }).format(now);
    if (weekday !== "Mon") continue;
    const day = localDay(row.timezone, now); const end = new Date(`${day}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); const last = end.toISOString().slice(0, 10);
    const key = `weekly:${row.portal.id}:${day}`;
    let logId: string | undefined;
    try {
      const [member] = await db.select({ id: users.id, role: memberships.role, permissions: memberships.permissions, accountRole: memberships.accountRole, grants: memberships.grants }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.userId, row.portal.createdBy), eq(memberships.companyId, row.portal.companyId), eq(memberships.active, true), eq(users.active, true)));
      if (!member) { results.push({ id: row.portal.id, status: "criador_sem_acesso" }); continue; }
      await assertFeature({ ...member, companyId: row.portal.companyId } as SessionUser, "weekly", "create");
      const config = await integrationConfig(row.portal.companyId); const transport = smtpTransport(config);
      const publicUrl = config.settings?.preferences.publicUrl; if (!publicUrl || !publicUrl.startsWith("https://") || !row.email) { results.push({ id: row.portal.id, status: "aguardando_email_ou_url_publica" }); continue; }
      const [secret] = await db.select({ data: productRecords.data }).from(productRecords).where(and(eq(productRecords.id, row.portal.id), eq(productRecords.companyId, row.portal.companyId), eq(productRecords.module, "portal-secrets")));
      if (!secret?.data.encryptedToken) { results.push({ id: row.portal.id, status: "area_sem_credencial" }); continue; }
      const token = decrypt(String(secret.data.encryptedToken)); const data = await portalData(token);
      const tasks = data.tasks.filter(t => t.dueDate >= day && t.dueDate <= last);
      const subject = `${row.companyName} · sua semana de ${day}`;
      const [claim] = await db.insert(messageLog).values({ companyId: row.portal.companyId, channel: "email", recipient: row.email, subject, status: "pendente", requestKey: key, createdBy: row.portal.createdBy }).onConflictDoNothing().returning();
      if (!claim) { results.push({ id: row.portal.id, status: "ja_processado" }); continue; }
      logId = claim.id;
      const text = [`Olá, ${row.name}.`, `Resumo da semana de ${day} a ${last}.`, ...data.events.filter(e => e.eventDate >= day && e.eventDate <= last).map(e => `${e.eventDate}: ${e.eventName}`), ...tasks.map(t => `${t.dueDate}: ${t.name} (${t.done ? "concluída" : "pendente"})`), `Acompanhe: ${publicUrl.replace(/\/$/, "")}/area-cliente/${token}`].join("\n");
      const sent = await transport.sendMail({ from: config.config.mailFrom, to: row.email, subject, text });
      if (sent.accepted.length === 0) throw new Error("SMTP não aceitou o destinatário");
      await db.update(messageLog).set({ status: "enviado", providerId: sent.messageId }).where(eq(messageLog.id, logId));
      results.push({ id: row.portal.id, status: "aceito_smtp" });
    } catch {
      if (logId) await db.update(messageLog).set({ status: "incerto", error: "Conferir o provedor antes de repetir este envio semanal." }).where(eq(messageLog.id, logId));
      results.push({ id: row.portal.id, status: logId ? "incerto" : "aguardando_configuracao_ou_permissao" });
    }
  }
  return { results };
}
