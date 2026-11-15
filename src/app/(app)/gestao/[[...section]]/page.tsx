import { Management } from "@/components/management/Management";
import { redirect } from "next/navigation";
export default async function ManagementPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  if (section?.[0] === "atendimento") redirect("/atendimento");
  return <Management key={section?.join("/") ?? "home"} section={section?.join("/")} />;
}
