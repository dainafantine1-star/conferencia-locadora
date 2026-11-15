import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { assertFeature } from "@/lib/saas/access";
import { db } from "@/lib/db";
import { financialEntries, productRecords } from "@/lib/db/schema";
import { jsonError } from "@/lib/api/http";
import { uuid, fail } from "@/lib/erp/common";
import { getPrivateFile, putPrivateFile } from "@/lib/storage";
import { assertOrigin, boundedBytes } from "@/lib/assistant/http";
export async function POST(req: NextRequest) {
  try {
    assertOrigin(req);
    const { user } = await requireSession(); await assertFeature(user, "advanced_finance", "create"); await assertFeature(user, "finance", "financial");
    const bytes = await boundedBytes(req, 5 * 1024 * 1024 + 64000);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file"), entryId = uuid.parse(form.get("entryId"));
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) fail("Informe um comprovante PDF ou imagem de até 5 MB", 400);
    const [entry] = await db.select({ id: financialEntries.id }).from(financialEntries).where(and(eq(financialEntries.id, entryId), eq(financialEntries.companyId, user.companyId)));
    if (!entry) fail("Conta não encontrada", 404);
    const extension = ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[file.type];
    const storedName = randomUUID() + extension;
    await putPrivateFile(user.companyId, storedName, Buffer.from(await file.arrayBuffer()), file.type);
    const [record] = await db.insert(productRecords).values({ companyId: user.companyId, module: "comprovantes", title: file.name.slice(0, 300), createdBy: user.id, data: { entryId, storedName, mime: file.type, size: file.size } }).returning();
    return Response.json({ id: record.id, uploaded: true });
  } catch (e) { return jsonError(e); }
}
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireSession(); await assertFeature(user, "advanced_finance"); await assertFeature(user, "finance", "financial");
    const id = uuid.parse(req.nextUrl.searchParams.get("id")); const [record] = await db.select().from(productRecords).where(and(eq(productRecords.id, id), eq(productRecords.companyId, user.companyId), eq(productRecords.module, "comprovantes")));
    if (!record) fail("Comprovante não encontrado", 404);
    const data = await getPrivateFile(user.companyId, String(record.data.storedName));
    const extension = ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[String(record.data.mime)] ?? ".bin";
    return new Response(new Uint8Array(data), { headers: { "Content-Type": String(record.data.mime), "Content-Disposition": `attachment; filename="comprovante${extension}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return jsonError(e); }
}
