import { NextRequest } from "next/server";
import { requireSession, AuthError } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));
}

/** Serve foto com validação de tenant no servidor. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { user } = await requireSession();
    const { path: parts } = await params;
    const storedName = parts[parts.length - 1];
    if (!storedName || storedName.includes("..")) {
      return Response.json({ error: "Caminho inválido" }, { status: 400 });
    }

    const [att] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.storedName, storedName), eq(attachments.companyId, user.companyId)));
    if (!att) {
      return Response.json({ error: "Não encontrado" }, { status: 404 });
    }

    const fullPath = path.join(storageRoot(), user.companyId, storedName);
    if (!fs.existsSync(fullPath)) {
      return Response.json({ error: "Arquivo ausente" }, { status: 404 });
    }

    const data = fs.readFileSync(fullPath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: "Erro" }, { status: 500 });
  }
}
