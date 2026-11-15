import { AuthError, type SessionUser } from "@/lib/auth/session";
import { assertFeature } from "./access";

export async function dashboardVisibility(user: SessionUser) {
  await assertFeature(user, "returns", "view");
  try {
    await assertFeature(user, "finance", "financial");
    return { financial: true };
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) return { financial: false };
    throw error;
  }
}
