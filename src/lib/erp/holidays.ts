import { z } from "zod";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { day, uuid, fail, audit } from "./common";

export async function holidayData(user: SessionUser, query: URLSearchParams) {
  const year = z.coerce.number().int().min(1900).max(2199).parse(query.get("year") ?? new Date().getFullYear());
  return { year, holidays: await db.select().from(holidays).where(and(eq(holidays.companyId, user.companyId),
    gte(holidays.day, `${year}-01-01`), lte(holidays.day, `${year}-12-31`))).orderBy(asc(holidays.day)) };
}
export async function saveHoliday(user: SessionUser, input: unknown) {
  const data = z.object({ day, name: z.string().trim().min(2).max(200) }).parse(input);
  const [holiday] = await db.insert(holidays).values({ companyId: user.companyId, ...data, source: "manual" })
    .onConflictDoNothing().returning();
  return { holiday, duplicated: !holiday };
}
export async function deleteHoliday(user: SessionUser, input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  await db.transaction(async tx => {
    const [row] = await tx.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.companyId, user.companyId))).returning();
    if (!row) fail("Data não encontrada", 404);
    await audit(tx, user, "feriado_removido", { id, day: row.day });
  });
  return { ok: true };
}
export async function importHolidays(user: SessionUser, input: unknown) {
  const { year } = z.object({ year: z.number().int().min(1900).max(2199) }).parse(input);
  const url = `https://brasilapi.com.br/api/feriados/v1/${year}`;
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" }); }
  catch { fail("Não foi possível consultar a BrasilAPI. Cadastre as datas manualmente ou tente depois.", 502); }
  if (!response.ok) fail("A fonte de feriados não respondeu corretamente", 502);
  const data = z.array(z.object({ date: day, name: z.string().min(1).max(200), type: z.string() })).min(1).max(100).parse(await response.json());
  if (data.some(r => !r.date.startsWith(`${year}-`))) fail("A fonte retornou datas de outro ano", 502);
  const inserted = await db.transaction(async tx => {
    const rows = await tx.insert(holidays).values(data.map(r => ({ companyId: user.companyId, day: r.date, name: r.name, source: url })))
      .onConflictDoNothing().returning();
    await audit(tx, user, "calendario_importado", { year, source: url, imported: rows.length });
    return rows.length;
  });
  return { imported: inserted, source: url, message: "Confira feriados locais e pontos facultativos conforme seu município." };
}
