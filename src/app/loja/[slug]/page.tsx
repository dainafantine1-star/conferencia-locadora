import { notFound } from "next/navigation";
import { publicStore } from "@/lib/erp/store";
import { Storefront } from "@/components/Storefront";
import { AuthError } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await publicStore(slug).catch(error => { if (error instanceof AuthError && error.status === 404) notFound(); throw error; });
  return <Storefront store={store} />;
}
