import { Activation } from "@/components/saas/Activation";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{ token: string }> }) { return <Activation token={(await params).token} />; }
