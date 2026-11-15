import { requireSession } from "@/lib/auth/session";
import { assertPlatform } from "@/lib/saas/platform";
import { Platform } from "@/components/saas/Platform";
import { notFound } from "next/navigation";
export default async function Page() { const { user } = await requireSession(); await assertPlatform(user).catch(() => notFound()); return <Platform />; }
