import { notFound } from "next/navigation";
import { sharedDocument } from "@/lib/erp/store";
import { SharedDocument } from "@/components/SharedDocument";
import { AuthError } from "@/lib/auth/session";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function DocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await sharedDocument(token).catch(error => { if (error instanceof AuthError && error.status === 404) notFound(); throw error; });
  return <SharedDocument document={doc} token={token} />;
}
