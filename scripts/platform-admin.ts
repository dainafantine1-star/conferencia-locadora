import { config } from "dotenv";
import { eq } from "drizzle-orm";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Informe PLATFORM_ADMIN_EMAIL no ambiente. Nenhum usuário recebe acesso à plataforma automaticamente.");
  const { db } = await import("../src/lib/db"); const { users, platformAdmins } = await import("../src/lib/db/schema");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user?.active) throw new Error("Cadastre primeiro uma conta ativa com este e-mail.");
  await db.insert(platformAdmins).values({ userId: user.id }).onConflictDoNothing();
  console.log("Acesso administrativo Detali concedido à conta indicada. Entre em /admin-detali. Remova PLATFORM_ADMIN_EMAIL do ambiente.");
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
