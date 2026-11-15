import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { fail } from "@/lib/erp/common";
import { weeklyReports } from "@/lib/saas/weekly";
export const runtime = "nodejs";
export async function POST(req: NextRequest) { return handle(async () => {
  const secret = process.env.CRON_SECRET; if (!secret || secret.length < 32) fail("Agendador aguardando configuração", 503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail("Não autorizado", 401);
  return weeklyReports();
}); }
