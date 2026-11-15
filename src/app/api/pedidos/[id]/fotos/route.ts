import { NextRequest } from "next/server";
import { requireSession, assertOrderAccess, AuthError } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { attachments, returns } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import { putPrivateFile } from "@/lib/storage";
import { assertFeature } from "@/lib/saas/access";
import crypto from "crypto";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession();
    await assertFeature(user, "returns", "create");
    const { id } = await params;
    const order = await assertOrderAccess(id, user);

    const form = await req.formData();
    const file = form.get("file");
    const returnId = form.get("returnId")?.toString() ?? null;

    if (!(file instanceof File)) {
      return Response.json({ error: "Arquivo ausente" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return Response.json({ error: "Tipo de imagem não permitido" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: "Imagem acima de 5MB" }, { status: 400 });
    }

    if (returnId) {
      const [ret] = await db
        .select()
        .from(returns)
        .where(and(eq(returns.id, returnId), eq(returns.companyId, user.companyId)));
      if (!ret || ret.orderId !== order.id) {
        return Response.json({ error: "Devolução não encontrada" }, { status: 404 });
      }
    }

    const storedName = `${crypto.randomUUID()}${path.extname(file.name) || ".jpg"}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await putPrivateFile(user.companyId, storedName, buf, file.type);

    const [att] = await db
      .insert(attachments)
      .values({
        companyId: user.companyId,
        returnId,
        orderId: order.id,
        filename: file.name || "foto.jpg",
        storedName,
        mime: file.type,
        sizeBytes: file.size,
        createdBy: user.id,
      })
      .returning();

    return Response.json({ attachment: att });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: "Erro ao salvar foto" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession();
    await assertFeature(user, "returns");
    const { id } = await params;
    await assertOrderAccess(id, user);
    const list = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.orderId, id), eq(attachments.companyId, user.companyId)));
    return Response.json({ attachments: list });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Erro" }, { status: 500 });
  }
}
