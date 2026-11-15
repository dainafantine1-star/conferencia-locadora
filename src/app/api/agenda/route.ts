import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agendaSlots } from "@/lib/db/schema";
import { requireSession, requireGestor } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { periodAvailability } from "@/lib/erp/inventory";

const daySchema = z.iso.date();
const slotSchema = z.object({
  day: daySchema,
  hour: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido"),
  capacity: z.number().int().min(0).max(10000),
  booked: z.number().int().min(0).max(10000),
}).refine((s) => s.booked <= s.capacity, "Reservas não podem exceder a capacidade");

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    const day = daySchema.parse(req.nextUrl.searchParams.get("day"));
    const slots = await db.select().from(agendaSlots).where(eq(agendaSlots.companyId, user.companyId)).orderBy(agendaSlots.day, agendaSlots.hour);
    const available = await periodAvailability(user, day, day);
    return { slots, canManage: user.role === "gestor", items: available.map((i) => ({
      id: i.id, name: i.name, unit: i.unit, stockQty: i.stockQty,
      reserved: i.reserved,
      unavailableQty: i.unavailableQty,
      available: i.available,
    })) };
  });
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireGestor();
    const body = slotSchema.parse(await req.json());
    const [slot] = await db.insert(agendaSlots).values({ ...body, companyId: user.companyId })
      .onConflictDoUpdate({ target: [agendaSlots.companyId, agendaSlots.day, agendaSlots.hour], set: { capacity: body.capacity, booked: body.booked } }).returning();
    return { slot };
  });
}
