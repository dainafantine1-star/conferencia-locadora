import { NextRequest } from "next/server";
import { requireGestor } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { teamData, createMember, updateMember } from "@/lib/erp/team";
export async function GET() { return handle(async () => teamData((await requireGestor()).user)); }
export async function POST(req: NextRequest) { return handle(async () => createMember((await requireGestor()).user, await req.json())); }
export async function PATCH(req: NextRequest) { return handle(async () => updateMember((await requireGestor()).user, await req.json())); }
