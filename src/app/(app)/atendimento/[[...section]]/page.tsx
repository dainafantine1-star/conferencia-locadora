import { notFound } from "next/navigation";
import { requirePermission, requireGestor } from "@/lib/auth/session";
import { AttendanceWorkspace } from "@/components/management/AttendanceWorkspace";

export default async function AttendancePage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const tab = section?.join("/") ?? "conversas";
  if (!["conversas", "agentes", "conhecimento", "automacoes", "configuracoes"].includes(tab)) notFound();
  await requirePermission("atendimento");
  if (tab !== "conversas") await requireGestor();
  return <AttendanceWorkspace key={tab} tab={tab} />;
}
