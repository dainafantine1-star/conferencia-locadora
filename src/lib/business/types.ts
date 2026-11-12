import type { OrderItem, ReturnItem, Closure } from "@/lib/db/schema";

export type ItemBalance = {
  orderItemId: string;
  name: string;
  unit: string;
  qtyPlanned: number;
  qtyDelivered: number;
  qtyGood: number;
  qtyDamaged: number;
  qtyOpen: number;
  replacementCents: number | null;
  damageCents: number | null;
};

/**
 * Saldo físico por item: entregue − (bons + avariados).
 * Avaria conta como devolvido (reduz o saldo em aberto), sem duplicar como falta.
 */
export function computeBalance(
  item: Pick<
    OrderItem,
    "id" | "name" | "unit" | "qtyPlanned" | "qtyDelivered" | "replacementCents" | "damageCents"
  >,
  returnItems: Pick<ReturnItem, "orderItemId" | "qtyGood" | "qtyDamaged">[],
): ItemBalance {
  const delivered = item.qtyDelivered ?? 0;
  let qtyGood = 0;
  let qtyDamaged = 0;
  for (const ri of returnItems) {
    if (ri.orderItemId === item.id) {
      qtyGood += ri.qtyGood;
      qtyDamaged += ri.qtyDamaged;
    }
  }
  const qtyOpen = delivered - qtyGood - qtyDamaged;
  return {
    orderItemId: item.id,
    name: item.name,
    unit: item.unit,
    qtyPlanned: item.qtyPlanned,
    qtyDelivered: delivered,
    qtyGood,
    qtyDamaged,
    qtyOpen: Math.max(qtyOpen, 0),
    replacementCents: item.replacementCents,
    damageCents: item.damageCents,
  };
}

export function computeBalances(
  items: Pick<
    OrderItem,
    "id" | "name" | "unit" | "qtyPlanned" | "qtyDelivered" | "replacementCents" | "damageCents"
  >[],
  returnItems: Pick<ReturnItem, "orderItemId" | "qtyGood" | "qtyDamaged">[],
): ItemBalance[] {
  return items.map((item) => computeBalance(item, returnItems));
}

export type ClosingCalculation = {
  missingQty: number;
  damagedQty: number;
  goodQty: number;
  suggestedCents: number;
  perItem: {
    orderItemId: string;
    name: string;
    unit: string;
    missingQty: number;
    damagedQty: number;
    goodQty: number;
    missingValueCents: number;
    damagedValueCents: number;
    subtotalCents: number;
  }[];
};

/**
 * Reposição sugerida = faltas × valor de reposição + avarias × valor de avaria.
 * Usa centavos inteiros. Valor de avaria ausente cai para o de reposição.
 */
export function calculateClosing(balances: ItemBalance[]): ClosingCalculation {
  const perItem: ClosingCalculation["perItem"] = [];
  let missingQty = 0;
  let damagedQty = 0;
  let goodQty = 0;
  let suggestedCents = 0;

  for (const b of balances) {
    const missingValue = b.replacementCents ?? 0;
    const damageValue = b.damageCents ?? b.replacementCents ?? 0;
    const missingValueCents = b.qtyOpen * missingValue;
    const damagedValueCents = b.qtyDamaged * damageValue;
    const subtotal = missingValueCents + damagedValueCents;
    missingQty += b.qtyOpen;
    damagedQty += b.qtyDamaged;
    goodQty += b.qtyGood;
    suggestedCents += subtotal;
    perItem.push({
      orderItemId: b.orderItemId,
      name: b.name,
      unit: b.unit,
      missingQty: b.qtyOpen,
      damagedQty: b.qtyDamaged,
      goodQty: b.qtyGood,
      missingValueCents,
      damagedValueCents,
      subtotalCents: subtotal,
    });
  }

  return { missingQty, damagedQty, goodQty, suggestedCents, perItem };
}

export function applyAdjustment(
  suggestedCents: number,
  adjustmentCents: number,
): number {
  // Ajuste é desconto (valor positivo reduz a cobrança); não deixa final negativo.
  return Math.max(0, suggestedCents - adjustmentCents);
}

export function buildSummaryText(input: {
  orderNumber: number;
  customerName: string;
  eventName: string;
  items: {
    name: string;
    missingQty: number;
    damagedQty: number;
    unit: string;
    missingValueCents: number;
    damagedValueCents: number;
    subtotalCents: number;
  }[];
  suggestedCents: number;
  adjustmentCents: number;
  adjustmentReason?: string | null;
  finalCents: number;
  damageNote?: string;
}): string {
  const lines: string[] = [];
  lines.push(`*Pedido #${input.orderNumber}* — ${input.customerName}`);
  lines.push(`Evento: ${input.eventName}`);
  lines.push("");
  lines.push("Conferência de devolução:");
  for (const it of input.items) {
    if (it.missingQty === 0 && it.damagedQty === 0) continue;
    const parts: string[] = [];
    if (it.missingQty > 0) {
      parts.push(`${it.missingQty} ${it.unit} em falta`);
    }
    if (it.damagedQty > 0) {
      parts.push(`${it.damagedQty} ${it.unit} avariado(s)`);
    }
    lines.push(`• ${it.name}: ${parts.join(" + ")} — ${formatCents(it.subtotalCents)}`);
  }
  lines.push("");
  lines.push(`Total sugerido: ${formatCents(input.suggestedCents)}`);
  if (input.adjustmentCents > 0) {
    lines.push(
      `Ajuste: −${formatCents(input.adjustmentCents)}${input.adjustmentReason ? ` (${input.adjustmentReason})` : ""}`,
    );
  }
  lines.push(`*Total final: ${formatCents(input.finalCents)}*`);
  return lines.join("\n");
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function validateReturnQuantities(
  planned: { orderItemId: string; qtyGood: number; qtyDamaged: number; open: number }[],
): string | null {
  for (const p of planned) {
    if (!Number.isInteger(p.qtyGood) || !Number.isInteger(p.qtyDamaged)) {
      return "Quantidades devem ser inteiros";
    }
    if (p.qtyGood < 0 || p.qtyDamaged < 0) {
      return "Quantidades não podem ser negativas";
    }
    if (p.qtyGood + p.qtyDamaged > p.open) {
      return `Retorno acumulado excede o saldo em aberto`;
    }
  }
  return null;
}
