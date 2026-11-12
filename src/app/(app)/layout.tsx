import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/options";
import { AppShell } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role;
  return <AppShell role={role}>{children}</AppShell>;
}
