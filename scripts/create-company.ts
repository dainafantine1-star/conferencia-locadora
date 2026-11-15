import { config } from "dotenv";
import { z } from "zod";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const values = z.object({ name: z.string().trim().min(2), email: z.email(), password: z.string().min(12), company: z.string().trim().min(2) }).parse({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, company: process.env.COMPANY_NAME });
  const { db } = await import("../src/lib/db");
  const { users, companies, memberships } = await import("../src/lib/db/schema");
  const { hashPassword } = await import("../src/lib/auth/password");
  const [existing] = await db.select({ id: companies.id }).from(companies).limit(1);
  if (existing) throw new Error("Instalação já possui empresa. Cadastre os usuários pela área de equipe.");
  const passwordHash = await hashPassword(values.password);
  await db.transaction(async tx => {
    const [company] = await tx.insert(companies).values({ name: values.company, timezone: "America/Bahia" }).returning();
    const [user] = await tx.insert(users).values({ email: values.email.trim().toLowerCase(), name: values.name, passwordHash }).returning();
    await tx.insert(memberships).values({ companyId: company.id, userId: user.id, role: "gestor" });
  });
  console.log("Empresa e gestor criados sem dados demonstrativos. Entre no sistema para configurar os demais dados.");
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
