import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, companies, paymentCheckouts } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { AuthError, type SessionUser } from "@/lib/auth/session";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const cents = z.number().int().min(0).max(999999900);
export const positiveCents = cents.refine(n => n > 0, "Informe um valor maior que zero");
export const day = z.iso.date();
export const uuid = z.string().uuid();
export const emailValue = z.union([z.literal(""), z.email()]);
export const optionalEmail = emailValue.default("");
export const mediaValue = z.union([z.literal(""), z.string().url().refine(v => v.startsWith("https://"), "Use uma URL HTTPS")]);
export const mediaUrl = mediaValue.default("");
export const text = z.string().trim().max(2000).default("");
export function fail(message: string, status = 400): never { throw new AuthError(message, status); }
export function assertSafeCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999999900) fail("Valor fora do limite permitido");
  return value;
}
export function proportion(amount: number, numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number((BigInt(amount) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}
export function localDay(timezone = "America/Bahia", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}
export function nextDay(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export async function lockCompany(tx: Tx, companyId: string) {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
}
export async function assertNoOpenCheckout(tx: Tx, companyId: string, entryId: string) {
  const [pending] = await tx.select({ id: paymentCheckouts.id }).from(paymentCheckouts).where(and(eq(paymentCheckouts.companyId, companyId),
    eq(paymentCheckouts.entryId, entryId), inArray(paymentCheckouts.status, ["ativo", "criando", "incerto"]))).limit(1);
  if (pending) fail("Há uma cobrança online ativa ou incerta. Concilie o cancelamento ou a expiração no PagBank antes de alterar esta conta.", 409);
}
export async function audit(tx: Tx, user: SessionUser, action: string, payload: unknown, orderId?: string) {
  await tx.insert(auditLog).values({ companyId: user.companyId, createdBy: user.id, action, payload, orderId });
}
export function csv(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const escape = (v: unknown) => {
    const raw = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\ufeff" + [keys.map(escape).join(";"), ...rows.map(r => keys.map(k => escape(r[k])).join(";"))].join("\r\n");
}
