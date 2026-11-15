import { Signup } from "@/components/saas/Signup";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{ token: string }> }) { return <Signup inviteToken={(await params).token} />; }
