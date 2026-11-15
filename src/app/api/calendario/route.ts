import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { calendarData } from "@/lib/calendar/data";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    return calendarData(user, req.nextUrl.searchParams);
  });
}
