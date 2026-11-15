export type Slot = { day: string; hour: string; capacity: number; booked: number };

export function dayAvailability(slots: Slot[]) {
  if (!slots.length) return { status: "não configurada", remaining: 0 };
  const remaining = slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.booked), 0);
  return { status: remaining > 0 ? "aberta" : "fechada", remaining };
}

export function availableStock(total: number | null, reserved: number) {
  return total === null ? null : Math.max(0, total - reserved);
}
