import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { requireGestor } from "@/lib/auth/session";
import { extractKnowledge, saveKnowledge } from "@/lib/assistant/knowledge";
import { fail } from "@/lib/erp/common";
import { assertOrigin, boundedBytes } from "@/lib/assistant/http";
export const runtime = "nodejs";
export async function POST(req: NextRequest) { return handle(async () => {
  const { user } = await requireGestor();
  assertOrigin(req);
  if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) fail("Arquivo excede o limite", 413);
  const bytes = await boundedBytes(req, 6 * 1024 * 1024);
  const form = await new Response(bytes, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData(); const file = form.get("file");
  if (!(file instanceof File)) fail("Selecione um arquivo");
  return saveKnowledge(user, { title: String(form.get("title") || file.name), audience: String(form.get("audience") || "interno"), content: await extractKnowledge(file), active: true });
}); }
