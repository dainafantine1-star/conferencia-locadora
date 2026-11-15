import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/ui";
import { AssistantWidget } from "@/components/AssistantWidget";
import { accountContext } from "@/lib/saas/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const role = session.user.role;
  const context = await accountContext(session.user);
  return <AppShell role={role} permissions={session.user.permissions ?? []} featureAccess={context.features.map(f => ({ id: f.id, enabled: f.enabled, canView: f.actions.includes("view") }))} companyName={session.user.companyName}>{children}{context.features.some(f => f.id === "assistant" && f.enabled && f.actions.includes("view")) && <AssistantWidget identity={`${session.user.companyId}:${session.user.id}`} />}</AppShell>;
}
