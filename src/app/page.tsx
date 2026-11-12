import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/options";

export default async function Home() {
  const session = await auth();
  redirect(session ? "/painel" : "/login");
}
