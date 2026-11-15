import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/ui";
import { AssistantWidget } from "@/components/AssistantWidget";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const role = session.user.role;
  return <AppShell role={role} permissions={session.user.permissions ?? []}>{children}<AssistantWidget identity={`${session.user.companyId}:${session.user.id}`} /></AppShell>;
}
