import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/session";
import { ZodError } from "zod";
import { CredentialError } from "@/lib/erp/crypto";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof SyntaxError) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  if (error instanceof CredentialError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const msg = error.issues.map((i) => i.message).join("; ");
    return NextResponse.json({ error: msg || "Dados inválidos" }, { status: 400 });
  }
  if (error instanceof Error) {
    const msg = error.message;
    if (
      msg.includes("excede") ||
      msg.includes("negativ") ||
      msg.includes("inválid") ||
      msg.includes("obrigat") ||
      msg.includes("apenas") ||
      msg.includes("não pode") ||
      msg.includes("nao pode") ||
      msg.includes("incorret") ||
      msg.includes("já ") ||
      msg.includes("ja ") ||
      msg.includes("Informe") ||
      msg.includes("Confirme") ||
      msg.includes("Pedido") ||
      msg.includes("Saldo") ||
      msg.includes("Ajuste") ||
      msg.includes("Motivo") ||
      msg.includes("Entregue") ||
      msg.includes("Item") ||
      msg.includes("Cliente") ||
      msg.includes("E-mail") ||
      msg.includes("Senha") ||
      msg.includes("Apenas") ||
      msg.includes("Código") ||
      msg.includes("Etiqueta") ||
      msg.includes("bipagem") ||
      msg.includes("Saída") ||
      msg.includes("Devolução")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[api]", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
  console.error("[api]", error);
  return NextResponse.json({ error: "Erro interno" }, { status: 500 });
}

export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
