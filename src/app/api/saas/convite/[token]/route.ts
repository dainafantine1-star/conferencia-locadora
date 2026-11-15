import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { inviteInfo, acceptInvite } from "@/lib/saas/accounts";
import { limitPublicRequests } from "@/lib/erp/store";
type Context = { params: Promise<{ token: string }> };
export async function GET(_req: NextRequest, c: Context) { return handle(async () => inviteInfo((await c.params).token)); }
export async function POST(req: NextRequest, c: Context) { return handle(async () => {
  const { token } = await c.params; await limitPublicRequests(`accept-invite:${token}`, 10); return acceptInvite(token, await readJson(req, 10000));
}); }
