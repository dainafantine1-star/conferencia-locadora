import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, memberships, companies } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireGestor } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { hashPassword } from "@/lib/auth/password";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Senha mínima de 8 caracteres"),
  role: z.enum(["gestor", "operador"]),
});

export async function GET() {
  return handle(async () => {
    const { user } = await requireGestor();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        active: users.active,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.companyId, user.companyId));
    return { members: rows };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireGestor();
    const body = createSchema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) throw new Error("E-mail já cadastrado");

    const passwordHash = await hashPassword(body.password);
    const [created] = await db
      .insert(users)
      .values({ email, name: body.name, passwordHash })
      .returning();

    await db.insert(memberships).values({
      userId: created.id,
      companyId: user.companyId,
      role: body.role,
    });

    return { member: { id: created.id, name: created.name, email: created.email, role: body.role } };
  });
}
