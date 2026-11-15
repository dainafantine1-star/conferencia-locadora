import { db } from "../src/lib/db";
import * as schema from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { eq } from "drizzle-orm";

async function main() {
  const existing = await db.select().from(schema.companies);
  if (existing.length > 0) {
    console.log("Seed já aplicado — pulando.");
    return;
  }

  const pw = await hashPassword("demo1234");

  // --- Locadora 1: Louça & Festas (cenário das taças) ---
  const [emp1] = await db
    .insert(schema.companies)
    .values({ name: "Louça & Festas Bahia", timezone: "America/Bahia" })
    .returning();

  await db.insert(schema.users).values([
    { email: "gestor@louca.demo", passwordHash: pw, name: "Maria Gestora" },
    { email: "operador@louca.demo", passwordHash: pw, name: "João Operador" },
    { email: "gestor@outra.demo", passwordHash: pw, name: "Ana Outra Locadora" },
    { email: "operador@outra.demo", passwordHash: pw, name: "Pedro Outra Locadora" },
  ]);

  const users1 = await db.select().from(schema.users);
  const u = (email: string) => users1.find((x) => x.email === email)!;

  await db.insert(schema.memberships).values([
    { userId: u("gestor@louca.demo").id, companyId: emp1.id, role: "gestor" },
    { userId: u("operador@louca.demo").id, companyId: emp1.id, role: "operador" },
  ]);

  // --- Locadora 2: isolamento de tenant ---
  const [emp2] = await db
    .insert(schema.companies)
    .values({ name: "Festas Imperial", timezone: "America/Bahia" })
    .returning();

  await db.insert(schema.memberships).values([
    { userId: u("gestor@outra.demo").id, companyId: emp2.id, role: "gestor" },
    { userId: u("operador@outra.demo").id, companyId: emp2.id, role: "operador" },
  ]);

  // --- Catálogo locadora 1 ---
  await db.insert(schema.catalogItems).values([
    { companyId: emp1.id, name: "Taça de cristal", unit: "un", replacementCents: 1200, damageCents: 1200 },
    { companyId: emp1.id, name: "Prato raso 27cm", unit: "un", replacementCents: 800, damageCents: 800 },
    { companyId: emp1.id, name: "Mesa 1,80m", unit: "un", replacementCents: 15000, damageCents: 5000 },
    { companyId: emp1.id, name: "Cadeira importada", unit: "un", replacementCents: 9000, damageCents: 3000 },
    { companyId: emp1.id, name: "Toalha de linho", unit: "un", replacementCents: 4500, damageCents: 2000 },
  ]);

  const catalog1 = await db.select().from(schema.catalogItems);
  const c1 = (name: string) => catalog1.find((x) => x.name === name && x.companyId === emp1.id)!;

  // --- Catálogo locadora 2 ---
  await db.insert(schema.catalogItems).values([
    { companyId: emp2.id, name: "Taça de cristal", unit: "un", replacementCents: 1500, damageCents: 1500 },
    { companyId: emp2.id, name: "Castiçal dourado", unit: "un", replacementCents: 2500, damageCents: 1000 },
  ]);

  // --- Clientes ---
  const [cliente1] = await db
    .insert(schema.customers)
    .values({ companyId: emp1.id, name: "Casa Bella Eventos", phone: "(71) 99999-1111" })
    .returning();
  await db
    .insert(schema.customers)
    .values({ companyId: emp2.id, name: "Espaço Jardim", phone: "(71) 98888-2222" });

  // --- Pedido demo das taças (120 previstas, saída 118) ---
  const [pedido] = await db
    .insert(schema.orders)
    .values({
      companyId: emp1.id,
      number: 1001,
      customerId: cliente1.id,
      eventName: "Casamento Ana & Pedro",
      eventDate: "2026-11-07",
      returnDueDate: "2026-11-10",
      status: "aberto",
      createdBy: u("operador@louca.demo").id,
      exitConfirmedAt: new Date("2026-11-07T14:00:00Z"),
      exitConfirmedBy: u("operador@louca.demo").id,
      notes: "Cenário de demonstração das taças",
    })
    .returning();

  await db.insert(schema.orderItems).values([
    {
      orderId: pedido.id,
      catalogItemId: c1("Taça de cristal").id,
      name: "Taça de cristal",
      unit: "un",
      qtyPlanned: 120,
      qtyDelivered: 118,
      replacementCents: 1200,
      damageCents: 1200,
      position: 0,
    },
    {
      orderId: pedido.id,
      catalogItemId: c1("Prato raso 27cm").id,
      name: "Prato raso 27cm",
      unit: "un",
      qtyPlanned: 80,
      qtyDelivered: 80,
      replacementCents: 800,
      damageCents: 800,
      position: 1,
    },
  ]);

  // --- Pedido em aberto para testar painel e bipagem ---
  const [pedido2] = await db
    .insert(schema.orders)
    .values({
      companyId: emp1.id,
      number: 1002,
      customerId: cliente1.id,
      eventName: "Aniversário 50 anos",
      eventDate: "2026-11-14",
      returnDueDate: new Date().toISOString().slice(0, 10), // hoje — aparece no painel
      status: "aberto",
      createdBy: u("operador@louca.demo").id,
    })
    .returning();

  await db.insert(schema.orderItems).values([
    {
      orderId: pedido2.id,
      catalogItemId: c1("Taça de cristal").id,
      name: "Taça de cristal",
      unit: "un",
      qtyPlanned: 24,
      qtyDelivered: 24,
      replacementCents: 1200,
      damageCents: 1200,
      position: 0,
    },
    {
      orderId: pedido2.id,
      catalogItemId: c1("Prato raso 27cm").id,
      name: "Prato raso 27cm",
      unit: "un",
      qtyPlanned: 10,
      qtyDelivered: 10,
      replacementCents: 800,
      damageCents: 800,
      position: 1,
    },
  ]);

  // --- Pedido da outra locadora (isolamento) ---
  const cliente2 = (
    await db.select().from(schema.customers).where(eq(schema.customers.companyId, emp2.id))
  )[0];
  await db.insert(schema.orders).values({
    companyId: emp2.id,
    number: 2001,
    customerId: cliente2.id,
    eventName: "Formatura Turma 2026",
    eventDate: "2026-11-20",
    returnDueDate: "2026-11-23",
    status: "rascunho",
    createdBy: u("operador@outra.demo").id,
  });

  // --- Etiquetas demo (bipagem) ---
  // 3 unidades de taça + 1 caixa com 12 taças (para testar as duas formas)
  await db.insert(schema.scanLabels).values([
    {
      companyId: emp1.id,
      catalogItemId: c1("Taça de cristal").id,
      code: "LOC-TACA-0001",
      kind: "unidade",
      qty: 1,
    },
    {
      companyId: emp1.id,
      catalogItemId: c1("Taça de cristal").id,
      code: "LOC-TACA-0002",
      kind: "unidade",
      qty: 1,
    },
    {
      companyId: emp1.id,
      catalogItemId: c1("Taça de cristal").id,
      code: "LOC-TACA-0003",
      kind: "unidade",
      qty: 1,
    },
    {
      companyId: emp1.id,
      catalogItemId: c1("Taça de cristal").id,
      code: "LOC-CX-TA-12",
      kind: "caixa",
      qty: 12,
    },
    {
      companyId: emp1.id,
      catalogItemId: c1("Prato raso 27cm").id,
      code: "LOC-PRAT-0001",
      kind: "unidade",
      qty: 1,
    },
  ]);

  console.log("Seed concluído.");
  console.log("Credenciais (senha: demo1234):");
  console.log("  gestor@louca.demo / operador@louca.demo  → Louça & Festas Bahia");
  console.log("  gestor@outra.demo / operador@outra.demo  → Festas Imperial");
  console.log("Etiquetas demo: LOC-TACA-0001..0003 (unidade), LOC-CX-TA-12 (caixa +12), LOC-PRAT-0001");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
