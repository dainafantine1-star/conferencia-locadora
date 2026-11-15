import { config } from "dotenv";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL; if (!email) throw new Error("Informe PLATFORM_ADMIN_EMAIL no ambiente.");
  const { provisionPlatformAdmin } = await import("../src/lib/saas/activation");
  const result = await provisionPlatformAdmin(email);
  console.log(JSON.stringify({ ...result, url: (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "") + result.path }));
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
