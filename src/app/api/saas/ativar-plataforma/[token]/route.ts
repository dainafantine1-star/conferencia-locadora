import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { activationInfo, activatePlatform } from "@/lib/saas/activation";
import { limitPublicRequests } from "@/lib/erp/store";
type Context = { params: Promise<{ token: string }> };
export async function GET(_req: NextRequest, c: Context) { return handle(async () => { const info = await activationInfo((await c.params).token); return { email: info.email }; }); }
export async function POST(req: NextRequest, c: Context) { return handle(async () => { const { token } = await c.params; await limitPublicRequests(`activation:${token}`, 10); return activatePlatform(token, await readJson(req, 10000)); }); }
