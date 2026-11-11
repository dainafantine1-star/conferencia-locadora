/** Valores em centavos (inteiros) — nunca usar float. */

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function parseBRLToCents(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("Valor inválido");
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error("Valor inválido");
  return Math.round(value * 100);
}

export function isNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
