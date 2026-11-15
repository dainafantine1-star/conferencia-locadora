import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { fail } from "@/lib/erp/common";
import { constantEqual } from "@/lib/assistant/channels";
import { runJobs } from "@/lib/assistant/worker";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: NextRequest) { return handle(async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !constantEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) fail("Agendador não autorizado", 401);
  return runJobs();
}); }
