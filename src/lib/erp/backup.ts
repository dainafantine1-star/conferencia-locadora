import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { encrypt } from "./settings";
import { fail, audit, lockCompany, uuid } from "./common";

const tenantTables = ["memberships", "customers", "catalog_items", "scan_labels", "agenda_slots", "orders", "returns", "attachments", "closures", "billing_events", "audit_log", "company_settings", "suppliers", "stock_movements", "rental_documents", "financial_entries", "settlements", "commissions", "logistics_tasks", "store_pages", "store_leads", "message_log", "holidays", "payment_checkouts", "ai_settings", "ai_agents", "ai_knowledge", "ai_threads", "ai_messages", "ai_actions", "ai_runs", "ai_rules", "ai_jobs", "ai_deliveries", "fiscal_settings", "fiscal_invoices", "fiscal_deliveries"];
import { decodeBackup, type BackupPayload } from "./backup-format";
export { decodeBackup } from "./backup-format";
const backupRoot = () => path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), "storage", "backups"));
export async function createBackup(user: SessionUser) {
  const [run] = await db.insert(schema.backupRuns).values({ companyId: user.companyId, status: "executando" }).returning();
  try {
    const payload = await db.transaction(async tx => {
      await lockCompany(tx, user.companyId);
      const tables: BackupPayload["tables"] = {};
      for (const table of tenantTables) {
        const result = await tx.execute(sql`select * from ${sql.identifier(table)} where company_id = ${user.companyId}::uuid`);
        tables[table] = result.rows as Record<string, unknown>[];
      }
      const special = {
        companies: sql`select * from companies where id = ${user.companyId}::uuid`,
        users: sql`select distinct u.* from users u join memberships m on m.user_id = u.id where m.company_id = ${user.companyId}::uuid`,
        order_items: sql`select i.* from order_items i join orders o on o.id = i.order_id where o.company_id = ${user.companyId}::uuid`,
        return_items: sql`select i.* from return_items i join returns r on r.id = i.return_id where r.company_id = ${user.companyId}::uuid`,
      };
      for (const [table, query] of Object.entries(special)) tables[table] = (await tx.execute(query)).rows as Record<string, unknown>[];
      return { format: "detali-v1" as const, companyId: user.companyId, createdAt: new Date().toISOString(), tables, files: [] as BackupPayload["files"] };
    });
    const storageRoot = path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));
    for (const photo of payload.tables.attachments ?? []) {
      const key = path.join(user.companyId, String(photo.stored_name));
      const absolute = path.resolve(storageRoot, key);
      if (!key || !absolute.startsWith(storageRoot + path.sep)) fail("Caminho de anexo inválido no backup", 500);
      payload.files.push({ key, base64: (await readFile(absolute)).toString("base64") });
    }
    const encoded = encrypt(gzipSync(Buffer.from(JSON.stringify(payload))).toString("base64"));
    // Decrypt and validate the archive before marking it successful.
    const verified = decodeBackup(encoded);
    if (verified.companyId !== user.companyId) fail("Validação do backup falhou", 500);
    const checksum = createHash("sha256").update(encoded).digest("hex");
    await mkdir(backupRoot(), { recursive: true });
    await writeFile(path.join(backupRoot(), `${run.id}.detali`), encoded, { flag: "wx", mode: 0o600 });
    await db.transaction(async tx => {
      await tx.update(schema.backupRuns).set({ status: "concluido", storageKey: `${run.id}.detali`, checksum }).where(eq(schema.backupRuns.id, run.id));
      await audit(tx, user, "backup_criado", { id: run.id, checksum });
    });
    return { id: run.id, checksum, tables: Object.keys(payload.tables).length, files: payload.files.length };
  } catch (error) {
    await db.update(schema.backupRuns).set({ status: "falha", error: "Não foi possível concluir e validar o arquivo. Confira armazenamento e chave de criptografia." }).where(eq(schema.backupRuns.id, run.id));
    throw error;
  }
}
export async function backupData(user: SessionUser) {
  return { backups: await db.select({ id: schema.backupRuns.id, status: schema.backupRuns.status, checksum: schema.backupRuns.checksum,
    error: schema.backupRuns.error, createdAt: schema.backupRuns.createdAt }).from(schema.backupRuns).where(eq(schema.backupRuns.companyId, user.companyId)).orderBy(sql`${schema.backupRuns.createdAt} desc`).limit(100),
    schedulerConfigured: Boolean(process.env.CRON_SECRET), storage: "Diretório BACKUP_DIR no servidor. Copie os arquivos para armazenamento externo.",
  };
}
export async function downloadBackup(user: SessionUser, id: string) {
  uuid.parse(id);
  const [run] = await db.select().from(schema.backupRuns).where(and(eq(schema.backupRuns.id, id), eq(schema.backupRuns.companyId, user.companyId)));
  if (!run || run.status !== "concluido") fail("Backup não disponível", 404);
  const content = await readFile(path.join(backupRoot(), `${id}.detali`));
  if (createHash("sha256").update(content).digest("hex") !== run.checksum) fail("Checksum do backup inválido", 500);
  return content;
}
