import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import { handle } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { unstable_update } from "@/lib/auth/options";
import { accountContext } from "@/lib/saas/access";
import { addCompany, inviteMember, revokeInvite, updateAccess, accountMembers } from "@/lib/saas/accounts";
import { isPlatformAdmin } from "@/lib/saas/platform";
import { fail, uuid } from "@/lib/erp/common";
export async function GET(req: NextRequest) { return handle(async () => { const { user } = await requireSession(); return req.nextUrl.searchParams.get("team") === "1" ? accountMembers(user) : { ...await accountContext(user), platformAdmin: await isPlatformAdmin(user.id) }; }); }
export async function POST(req: NextRequest) { return handle(async () => {
  const { user } = await requireSession(); const body = await readJson(req, 20000);
  if (body.action === "invite") return inviteMember(user, body);
  if (body.action === "revoke") return revokeInvite(user, body);
  if (body.action === "access") return updateAccess(user, body);
  if (body.action === "company") return addCompany(user, body);
  if (body.action === "switch") {
    const companyId = uuid.parse(body.companyId); const context = await accountContext(user);
    if (!context.accounts.some(a => a.id === companyId)) fail("Acesso à empresa não autorizado", 403);
    await unstable_update({ user: { companyId } }); return { ok: true };
  }
  fail("Ação desconhecida", 400);
}); }
