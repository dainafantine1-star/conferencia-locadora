import { describe, it, expect } from "vitest";
import { brazilianDates, easter } from "@/lib/calendar/dates";
describe("datas reais do calendário brasileiro", () => {
  it("calcula datas móveis de 2026 verificadas no calendário federal", () => {
    const dates = brazilianDates(2026), date = (name: string) => dates.find(d => d.name === name)?.day;
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(date("Carnaval — terça-feira")).toBe("2026-02-17"); expect(date("Sexta-feira da Paixão")).toBe("2026-04-03"); expect(date("Corpus Christi")).toBe("2026-06-04");
    expect(date("Dia das Mães")).toBe("2026-05-10"); expect(date("Dia dos Pais")).toBe("2026-08-09"); expect(date("Black Friday")).toBe("2026-11-27"); expect(date("Cyber Monday")).toBe("2026-11-30");
  });
  it("recalcula no ano seguinte e não fixa a Black Friday na última sexta", () => {
    const dates = brazilianDates(2029); expect(dates.find(d => d.name === "Black Friday")?.day).toBe("2029-11-23");
    expect(brazilianDates(2027).find(d => d.name === "Dia das Mães")?.day).toBe("2027-05-09");
    expect(easter(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });
  it("não trata comemorações ou Carnaval como feriados nacionais", () => {
    const dates = brazilianDates(2026); expect(dates.find(d => d.name === "São João")?.kind).toBe("comemorativa"); expect(dates.find(d => d.name === "Carnaval — terça-feira")?.kind).toBe("facultativo");
    expect(dates.find(d => d.name.includes("Consciência Negra"))?.day).toBe("2026-11-20"); expect(dates.every(d => d.source?.startsWith("https://"))).toBe(true);
    expect(new Set(dates.map(d => d.id)).size).toBe(dates.length);
  });
  it("aceita o limite de anos e rejeita entradas inválidas", () => { expect(() => brazilianDates(2026.5)).toThrow(); expect(() => brazilianDates(2200)).toThrow(); expect(brazilianDates(2199).length).toBeGreaterThan(30); });
});
