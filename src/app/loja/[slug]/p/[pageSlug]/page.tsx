import Link from "next/link";
import { notFound } from "next/navigation";
import { publicPage } from "@/lib/erp/store";
import { AuthError } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export default async function DynamicPage({ params }: { params: Promise<{ slug: string; pageSlug: string }> }) {
  const { slug, pageSlug } = await params;
  const { store, page } = await publicPage(slug, pageSlug).catch(error => { if (error instanceof AuthError && error.status === 404) notFound(); throw error; });
  return <main className="mx-auto max-w-3xl space-y-6 p-6"><Link href={`/loja/${slug}`} className="inline-flex min-h-11 items-center font-semibold text-action underline">← {store.storefront.title || slug}</Link><h1 className="text-3xl font-bold">{page.title}</h1><article className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white p-6 leading-relaxed">{page.content}</article></main>;
}
