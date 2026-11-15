import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiKnowledge } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { uuid, audit, fail, lockCompany } from "@/lib/erp/common";
import { assertAllowed } from "./config";
import { normalized } from "./help";

const schema = z.object({ id: uuid.optional(), title: z.string().trim().min(3).max(200),
  content: z.string().trim().min(10).max(100000), audience: z.enum(["interno", "publico"]), active: z.boolean().default(true) }).strict();
export async function saveKnowledge(user: SessionUser, input: unknown) {
  await assertFeature(user, "attendance", "edit");
  assertAllowed(user, "gestor"); const data = schema.parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const rows = await tx.select({ id: aiKnowledge.id, content: aiKnowledge.content }).from(aiKnowledge).where(eq(aiKnowledge.companyId, user.companyId));
    if (data.id && !rows.some(r => r.id === data.id)) fail("Material não encontrado", 404);
    if (rows.filter(r => r.id !== data.id).reduce((n, r) => n + r.content.length, data.content.length) > 2000000 || (!data.id && rows.length >= 300)) fail("Limite de conhecimento atingido. Revise o acervo antes de adicionar material.", 409);
    const { id, ...values } = data;
    const [source] = id ? await tx.update(aiKnowledge).set({ ...values, updatedAt: new Date() }).where(and(eq(aiKnowledge.id, id), eq(aiKnowledge.companyId, user.companyId))).returning()
      : await tx.insert(aiKnowledge).values({ ...values, companyId: user.companyId, createdBy: user.id }).returning();
    await audit(tx, user, "conhecimento_salvo", { sourceId: source.id, audience: source.audience });
    return { source };
  });
}
export async function knowledgeData(user: SessionUser) {
  await assertFeature(user, "attendance", "view");
  assertAllowed(user, "gestor");
  return { sources: await db.select().from(aiKnowledge).where(eq(aiKnowledge.companyId, user.companyId)).orderBy(desc(aiKnowledge.updatedAt)).limit(300) };
}
export async function retrieveKnowledge(companyId: string, query: string, publicOnly = false) {
  const words = [...new Set(normalized(query).split(/[^a-z0-9]+/).filter(w => w.length > 2))];
  if (!words.length) return [];
  const rows = await db.select().from(aiKnowledge).where(and(eq(aiKnowledge.companyId, companyId), eq(aiKnowledge.active, true), publicOnly ? eq(aiKnowledge.audience, "publico") : undefined)).limit(300);
  return rows.flatMap(row => {
    const chunks = row.content.match(/[\s\S]{1,1600}/g) ?? [];
    return chunks.map((text, index) => ({ id: row.id, title: row.title, excerpt: text, chunk: index + 1,
      score: words.reduce((n, w) => n + (normalized(row.title).includes(w) ? 5 : 0) + (normalized(text).includes(w) ? 1 : 0), 0) }));
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}
export async function extractKnowledge(file: File) {
  if (file.size > 5 * 1024 * 1024) fail("O arquivo deve ter no máximo 5 MB", 413);
  const extension = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  if (["txt", "md"].includes(extension ?? "")) text = await file.text();
  else if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
    const document = await task.promise;
    try {
      if (document.numPages > 100) fail("O PDF deve ter no máximo 100 páginas");
      for (let i = 1; i <= document.numPages; i++) {
        const page = await document.getPage(i); const content = await page.getTextContent();
        text += content.items.map(item => "str" in item ? item.str : "").join(" ") + "\n";
        if (text.length > 100000) fail("O texto extraído excede 100 mil caracteres");
      }
    } finally { await task.destroy(); }
  } else fail("Envie PDF com texto, TXT ou Markdown");
  if (text.trim().length < 10) fail("Não foi possível extrair texto. PDFs digitalizados precisam de OCR antes do envio.");
  return text.replaceAll("\u0000", "");
}
