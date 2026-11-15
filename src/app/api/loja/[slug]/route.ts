import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { fail } from "@/lib/erp/common";
import { limitPublicRequests, submitLead, publicStore } from "@/lib/erp/store";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    if (Number(req.headers.get("content-length")) > 50000) fail("Requisição muito grande", 413);
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 50000) fail("Requisição muito grande", 413);
    const { slug } = await params;
    await publicStore(slug);
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost: string;
      try { originHost = new URL(origin).host; } catch { fail("Origem não aceita", 403); }
      const requestHost = req.headers.get("host") ?? req.nextUrl.host;
      const configuredOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : "";
      if (originHost.toLowerCase() !== requestHost.toLowerCase() && origin !== configuredOrigin) fail("Origem não aceita", 403);
    }
    // Only trust the proxy header when the hosting environment sets it.
    const address = process.env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : "local";
    await limitPublicRequests(`loja:${slug}:${address}`, process.env.TRUST_PROXY === "1" ? 20 : 200);
    return submitLead(slug, JSON.parse(raw));
  });
}
