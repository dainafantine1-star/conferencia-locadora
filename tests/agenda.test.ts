import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { dayAvailability } from "@/lib/business/availability";

const auth = vi.hoisted(() => ({ id: "", companyId: "00000000-0000-4000-8000-000000000001", role: "gestor" }));
vi.mock("@/lib/auth/session", () => {
  class AuthError extends Error { constructor(message: string, public status = 401) { super(message); } }
  return { AuthError, requireSession: async () => ({ user: auth }), requireGestor: async () => {
    if (auth.role !== "gestor") throw new AuthError("Apenas gestores", 403);
    return { user: auth };
  } };
});
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const client = new PGlite();
  return { db: drizzle(client, { schema }), client };
});
import { db } from "@/lib/db";
import { GET, PUT } from "@/app/api/agenda/route";
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
let client: PGlite;
let itemId: string;

beforeAll(async () => {
  client = (await import("@/lib/db") as unknown as { client: PGlite }).client;
  for (const file of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) await client.exec(readFileSync(`drizzle/${file}`, "utf8"));
  await db.insert(schema.companies).values([{ id: first, name: "A" }, { id: second, name: "B" }]);
  const [user] = await db.insert(schema.users).values({ name: "Teste", email: "test@example.com", passwordHash: "test" }).returning();
  auth.id = user.id;
  await db.insert(schema.memberships).values([{ userId: user.id, companyId: first, role: "gestor" }, { userId: user.id, companyId: second, role: "gestor" }]);
  const [customer] = await db.insert(schema.customers).values({ companyId: first, name: "Cliente" }).returning();
  const [item] = await db.insert(schema.catalogItems).values({ companyId: first, name: "Taça", unit: "un", stockQty: 100, replacementCents: 100 }).returning();
  itemId = item.id;
  await db.insert(schema.catalogItems).values([{ companyId: first, name: "Sem estoque", replacementCents: 0 }, { companyId: second, name: "Outra empresa", stockQty: 10, replacementCents: 0 }]);
  for (const [index, status] of (["rascunho", "aberto", "encerrado"] as const).entries()) {
    const [order] = await db.insert(schema.orders).values({ companyId: first, number: index + 1, customerId: customer.id, eventName: "Evento", eventDate: "2027-01-17", returnDueDate: "2027-01-19", status, createdBy: user.id }).returning();
    await db.insert(schema.orderItems).values({ orderId: order.id, catalogItemId: item.id, name: "Taça", qtyPlanned: 30 });
  }
}, 120000);
beforeEach(() => { auth.companyId = first; auth.role = "gestor"; });
afterAll(async () => { await client?.close(); });
function request(body: object) { return new NextRequest("http://localhost/api/agenda", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
const slot = { day: "2027-01-18", hour: "14:00", capacity: 3, booked: 2 };

it("mantém o dia aberto com reservas e fecha somente ao esgotar as vagas", async () => {
  expect((await PUT(request(slot))).status).toBe(200);
  let data = await (await GET(new NextRequest("http://localhost/api/agenda?day=2027-01-18"))).json();
  expect(dayAvailability(data.slots)).toEqual({ status: "aberta", remaining: 1 });
  await PUT(request({ ...slot, booked: 3 }));
  data = await (await GET(new NextRequest("http://localhost/api/agenda?day=2027-01-18"))).json();
  expect(data.slots).toHaveLength(1);
  expect(dayAvailability(data.slots).status).toBe("fechada");
  await PUT(request(slot));
});
it("rejeita reservas acima da capacidade, data e hora inválidas", async () => {
  for (const body of [{ ...slot, booked: 4 }, { ...slot, day: "2027-02-30" }, { ...slot, hour: "25:00" }, { ...slot, capacity: -1 }]) expect((await PUT(request(body))).status).toBe(400);
});
it("isola empresas e impede operador de editar", async () => {
  auth.companyId = second;
  const data = await (await GET(new NextRequest("http://localhost/api/agenda?day=2027-01-18"))).json();
  expect(data.slots).toEqual([]);
  expect(data.items.map((i: { name: string }) => i.name)).toEqual(["Outra empresa"]);
  auth.role = "operador";
  expect((await PUT(request(slot))).status).toBe(403);
});
it("desconta pedidos simultâneos e rascunhos, ignora encerrados e inclui a data de devolução", async () => {
  for (const day of ["2027-01-17", "2027-01-18", "2027-01-19"]) {
    const data = await (await GET(new NextRequest(`http://localhost/api/agenda?day=${day}`))).json();
    expect(data.items.find((i: { id: string }) => i.id === itemId)).toMatchObject({ reserved: 60, available: 40 });
    expect(data.items.find((i: { name: string }) => i.name === "Sem estoque").available).toBeNull();
  }
  const data = await (await GET(new NextRequest("http://localhost/api/agenda?day=2027-01-20"))).json();
  expect(data.items.find((i: { id: string }) => i.id === itemId).available).toBe(100);
});
it("não marca dia sem configuração como fechado", () => {
  expect(dayAvailability([]).status).toBe("não configurada");
});
