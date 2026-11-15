import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { registerCompany } from "@/lib/saas/accounts";
import { limitPublicRequests } from "@/lib/erp/store";
import { fail } from "@/lib/erp/common";
export async function POST(req: NextRequest) { return handle(async () => {
  if (Number(req.headers.get("content-length")) > 10000) fail("Requisição muito grande", 413);
  await limitPublicRequests("company-signup:global", 100);
  const body = await readJson(req, 10000);
  await limitPublicRequests(`company-signup:${String(body.email).trim().toLowerCase()}`, 5);
  return registerCompany(body);
}); }
