import { db } from "@/lib/db";
import { saasPlans } from "@/lib/db/schema";
import { ensurePlans } from "@/lib/saas/access";
import { handle } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export async function GET() { return handle(async () => { await ensurePlans(); return { plans: await db.select({ id: saasPlans.id, name: saasPlans.name, monthlyCents: saasPlans.monthlyCents }).from(saasPlans).orderBy(saasPlans.id) }; }); }
