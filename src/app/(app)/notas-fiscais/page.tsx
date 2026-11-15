import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { FiscalWorkspace } from "@/components/fiscal/FiscalWorkspace";
export const dynamic = "force-dynamic";
export default async function FiscalPage() {
  const { user } = await requireSession();
  if (user.role !== "gestor" && !user.permissions?.includes("fiscal")) redirect("/painel");
  return <FiscalWorkspace />;
}
