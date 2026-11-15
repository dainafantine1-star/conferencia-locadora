/** Civil dates in Brazil. UTC arithmetic keeps movable dates independent of DST. */
export type CalendarDate = { id: string; day: string; name: string; kind: "feriado" | "comemorativa" | "facultativo" | "local" | "horario"; source?: string; detail?: string };
const government = "https://agenciagov.ebc.com.br/noticias/202512/confira-o-calendario-oficial-de-feriados-nacionais-e-pontos-facultativos-em-2026";
const commerce = "https://www.correios.com.br/aproxime/arquivos/datas-comemorativas-para-o-e-commerce_ebook.pdf";
const juninas = "https://educa.ibge.gov.br/criancas/voce-sabia/22429-santos-juninos.html";
const parents = "https://www.dof.ms.gov.br/datas/";
export const calendarSources = [
  { title: "Feriados nacionais — Governo Federal", href: government },
  { title: "Datas comerciais — Correios", href: commerce },
  { title: "Santos juninos — IBGE", href: juninas },
  { title: "Dia das Mães e Dia dos Pais — calendário oficial do DOF/MS", href: parents },
];
const fixedHolidays = [["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"], ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"], ["11-15", "Proclamação da República"], ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"], ["12-25", "Natal"]];
// Fixed commemorations from the Correios commercial calendar. Seasonal equinoxes
// are deliberately absent: their exact dates require an astronomical ephemeris.
const fixedCommemorations = [["01-07", "Dia do Leitor"], ["02-19", "Dia do Esportista"], ["03-08", "Dia Internacional da Mulher"], ["03-15", "Dia do Consumidor"], ["04-13", "Dia do Beijo"], ["04-23", "Dia Mundial do Livro"], ["05-25", "Dia do Orgulho Nerd"], ["06-12", "Dia dos Namorados"], ["07-26", "Dia dos Avós"], ["07-30", "Dia Internacional da Amizade"], ["08-15", "Dia da Informática"], ["08-29", "Dia do Gamer"], ["09-15", "Dia do Cliente"], ["10-12", "Dia das Crianças"], ["10-15", "Dia do Professor"], ["10-31", "Halloween"]];
const iso = (date: Date) => date.toISOString().slice(0, 10);
function shifted(date: Date, days: number) { return iso(new Date(date.getTime() + days * 86400000)); }
export function easter(year: number) {
  // Gregorian computus (Meeus/Jones/Butcher).
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1));
}
function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return new Date(Date.UTC(year, month - 1, 1 + (weekday - first + 7) % 7 + (occurrence - 1) * 7));
}
export function brazilianDates(year: number): CalendarDate[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2199) throw new Error("Ano fora do intervalo do calendário");
  const dates: CalendarDate[] = [];
  const add = (day: string, name: string, kind: CalendarDate["kind"], source: string, detail?: string) => dates.push({ id: `br:${day}:${name}`, day, name, kind, source, detail });
  for (const [day, name] of fixedHolidays) add(`${year}-${day}`, name, "feriado", government);
  for (const [day, name] of fixedCommemorations) add(`${year}-${day}`, name, "comemorativa", day === "07-26" ? "https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/saude-da-pessoa-idosa/datas-importantes-1/datas-importantes/26-de-julho-dia" : commerce);
  for (const [day, name] of [["06-13", "Santo Antônio"], ["06-24", "São João"], ["06-29", "São Pedro"]]) add(`${year}-${day}`, name, "comemorativa", juninas, "Celebração cultural e religiosa; feriado depende da legislação local.");
  const pascoa = easter(year);
  add(iso(pascoa), "Páscoa", "comemorativa", commerce);
  add(shifted(pascoa, -2), "Sexta-feira da Paixão", "local", government, "Data religiosa. Confira a legislação municipal; consta no calendário da administração federal.");
  add(shifted(pascoa, -48), "Carnaval — segunda-feira", "facultativo", government, "Referência da administração federal; não implica fechamento da locadora.");
  add(shifted(pascoa, -47), "Carnaval — terça-feira", "facultativo", government, "Referência da administração federal; feriado local depende da legislação.");
  add(shifted(pascoa, -46), "Quarta-feira de Cinzas", "facultativo", government, "Referência federal até as 14h; confira o expediente local.");
  add(shifted(pascoa, 60), "Corpus Christi", "facultativo", government, "Referência federal; feriado depende da legislação local.");
  add(iso(nthWeekday(year, 5, 0, 2)), "Dia das Mães", "comemorativa", parents);
  add(iso(nthWeekday(year, 8, 0, 2)), "Dia dos Pais", "comemorativa", parents);
  // Black Friday follows the fourth Thursday of November (not always the last Friday).
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  add(shifted(thanksgiving, 1), "Black Friday", "comemorativa", commerce);
  add(shifted(thanksgiving, 4), "Cyber Monday", "comemorativa", commerce);
  return dates.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "pt-BR"));
}
