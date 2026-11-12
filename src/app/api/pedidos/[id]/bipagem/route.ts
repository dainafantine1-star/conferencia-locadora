import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { scanLabels, orderItems, orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession, assertOrderAccess, AuthError } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

const schema = z.object({
  code: z.string().min(1),
  /** Em qual tela a bipagem acontece — só valida contexto, não grava. */
  context: z.enum(["saida", "retorno"]),
});

/**
 * Resolve um código bipado contra as etiquetas da empresa e devolve
 * o item do pedido correspondente + quanto essa bipagem conta.
 * A contagem é acumulada apenas no cliente (saída/retorno); aqui só validamos.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    const order = await assertOrderAccess(id, user);
    const body = schema.parse(await req.json());
    const code = body.code.trim().toUpperCase();

    if (body.context === "saida" && order.status !== "rascunho") {
      throw new Error("Saída já confirmada: bipagem indisponível");
    }
    if (body.context === "retorno" && order.status !== "aberto") {
      throw new Error("Pedido não está em aberto para retorno");
    }

    const [label] = await db
      .select()
      .from(scanLabels)
      .where(and(eq(scanLabels.companyId, user.companyId), eq(scanLabels.code, code)))
      .limit(1);
    if (!label || !label.active) {
      throw new Error(`Código não reconhecido: ${code}`);
    }

    const [orderItem] = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.catalogItemId, label.catalogItemId)))
      .limit(1);
    if (!orderItem) {
      throw new Error("Etiqueta não corresponde a nenhum item deste pedido");
    }

    return {
      orderItemId: orderItem.id,
      itemName: orderItem.name,
      unit: orderItem.unit,
      /** Quantidade que esta bipagem soma (1 por unidade, N por caixa). */
      qty: label.qty,
      kind: label.kind,
      code: label.code,
    };
  });
}
