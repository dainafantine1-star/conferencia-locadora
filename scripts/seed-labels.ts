import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";

async function main() {
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  const db = drizzle(pglite, { schema });

  const [emp] = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.name, "Louça & Festas Bahia"))
    .limit(1);
  if (!emp) {
    console.log("Empresa demo não encontrada — rode npm run db:seed antes.");
    await pglite.close();
    return;
  }

  const catalog = await db
    .select()
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.companyId, emp.id));
  const taca = catalog.find((c) => c.name === "Taça de cristal");
  const prato = catalog.find((c) => c.name === "Prato raso 27cm");
  if (!taca || !prato) {
    console.log("Catálogo demo incompleto.");
    await pglite.close();
    return;
  }

  const wanted = [
    { code: "LOC-TACA-0001", kind: "unidade" as const, qty: 1, catalogItemId: taca.id },
    { code: "LOC-TACA-0002", kind: "unidade" as const, qty: 1, catalogItemId: taca.id },
    { code: "LOC-TACA-0003", kind: "unidade" as const, qty: 1, catalogItemId: taca.id },
    { code: "LOC-CX-TA-12", kind: "caixa" as const, qty: 12, catalogItemId: taca.id },
    { code: "LOC-PRAT-0001", kind: "unidade" as const, qty: 1, catalogItemId: prato.id },
  ];

  let created = 0;
  for (const w of wanted) {
    const exists = await db
      .select()
      .from(schema.scanLabels)
      .where(and(eq(schema.scanLabels.companyId, emp.id), eq(schema.scanLabels.code, w.code)))
      .limit(1);
    if (exists.length === 0) {
      await db.insert(schema.scanLabels).values({ ...w, companyId: emp.id });
      created++;
    }
  }
  console.log(`Etiquetas demo: ${created} criadas (total desejado ${wanted.length}).`);
  await pglite.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
