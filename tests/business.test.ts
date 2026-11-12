import { describe, it, expect } from "vitest";
import {
  computeBalance,
  computeBalances,
  calculateClosing,
  applyAdjustment,
  buildSummaryText,
  buildWhatsAppUrl,
  validateReturnQuantities,
} from "../src/lib/business/types";

const item = {
  id: "oi-1",
  name: "Taça de cristal",
  unit: "un",
  qtyPlanned: 120,
  qtyDelivered: 118,
  replacementCents: 1200,
  damageCents: 1200,
};

describe("saldo físico", () => {
  it("entregue − (bons + avariados) = aberto", () => {
    const b = computeBalance(item, []);
    expect(b.qtyOpen).toBe(118);

    const b2 = computeBalance(item, [
      { orderItemId: "oi-1", qtyGood: 100, qtyDamaged: 2 },
      { orderItemId: "oi-1", qtyGood: 10, qtyDamaged: 0 },
    ]);
    // 118 - 110 - 2 = 6
    expect(b2.qtyGood).toBe(110);
    expect(b2.qtyDamaged).toBe(2);
    expect(b2.qtyOpen).toBe(6);
  });

  it("avaria reduz o saldo em aberto (não conta como falta)", () => {
    const b = computeBalance(item, [
      { orderItemId: "oi-1", qtyGood: 0, qtyDamaged: 5 },
    ]);
    expect(b.qtyOpen).toBe(113);
    expect(b.qtyDamaged).toBe(5);
  });
});

describe("fechamento — cenário das taças", () => {
  const balances = computeBalances(
    [item],
    [
      { orderItemId: "oi-1", qtyGood: 100, qtyDamaged: 2 },
      { orderItemId: "oi-1", qtyGood: 10, qtyDamaged: 0 },
    ],
  );

  it("gera 6 faltantes, 2 avarias, 110 bons e R$ 96,00", () => {
    const calc = calculateClosing(balances);
    expect(calc.missingQty).toBe(6);
    expect(calc.damagedQty).toBe(2);
    expect(calc.goodQty).toBe(110);
    // 6 × 12 + 2 × 12 = 96
    expect(calc.suggestedCents).toBe(9600);
  });

  it("ajuste de R$ 12 resulta em R$ 84,00", () => {
    const calc = calculateClosing(balances);
    expect(applyAdjustment(calc.suggestedCents, 1200)).toBe(8400);
  });

  it("ajuste não deixa final negativo", () => {
    expect(applyAdjustment(500, 9999)).toBe(0);
  });

  it("valor de avaria ausente cai para reposição", () => {
    const b = computeBalances(
      [{ ...item, damageCents: null }],
      [{ orderItemId: "oi-1", qtyGood: 0, qtyDamaged: 1 }],
    );
    // 117 faltantes × 12 + 1 avaria × 12 = 118 × 12
    const calc = calculateClosing(b);
    expect(calc.suggestedCents).toBe(118 * 1200);
  });
});

describe("devolver tudo em bom estado", () => {
  it("permite encerrar sem cobrança", () => {
    const balances = computeBalances(
      [{ ...item, qtyDelivered: 10 }],
      [{ orderItemId: "oi-1", qtyGood: 10, qtyDamaged: 0 }],
    );
    const calc = calculateClosing(balances);
    expect(calc.missingQty).toBe(0);
    expect(calc.damagedQty).toBe(0);
    expect(calc.suggestedCents).toBe(0);
  });
});

describe("validação de retornos", () => {
  it("rejeita acumulado acima do entregue", () => {
    const err = validateReturnQuantities([
      { orderItemId: "a", qtyGood: 5, qtyDamaged: 2, open: 6 },
    ]);
    expect(err).toBeTruthy();
  });

  it("rejeita negativos e não inteiros", () => {
    expect(validateReturnQuantities([{ orderItemId: "a", qtyGood: -1, qtyDamaged: 0, open: 5 }])).toBeTruthy();
    expect(validateReturnQuantities([{ orderItemId: "a", qtyGood: 1.5, qtyDamaged: 0, open: 5 }])).toBeTruthy();
  });

  it("aceita dentro do saldo", () => {
    expect(
      validateReturnQuantities([{ orderItemId: "a", qtyGood: 4, qtyDamaged: 2, open: 6 }]),
    ).toBeNull();
  });
});

describe("resumo WhatsApp", () => {
  it("contém número, itens e total", () => {
    const text = buildSummaryText({
      orderNumber: 1001,
      customerName: "Casa Bella",
      eventName: "Casamento",
      items: [
        {
          name: "Taça",
          missingQty: 6,
          damagedQty: 2,
          unit: "un",
          missingValueCents: 7200,
          damagedValueCents: 2400,
          subtotalCents: 9600,
        },
      ],
      suggestedCents: 9600,
      adjustmentCents: 1200,
      adjustmentReason: "Cliente fiel",
      finalCents: 8400,
    });
    expect(text).toContain("#1001");
    expect(text).toContain("6 un em falta");
    expect(text).toContain("R$");
    expect(text).toContain("84,00");
    const url = buildWhatsAppUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("#1001");
  });
});
