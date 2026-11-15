import { Product } from "@/components/saas/Product";
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) { const { section } = await params; return <Product module={section?.[0] ?? ""} />; }
