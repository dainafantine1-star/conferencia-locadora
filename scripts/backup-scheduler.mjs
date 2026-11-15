import { config } from "dotenv";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
// Run one worker alongside the application, or call the same endpoint from cron.
const base = process.env.AUTH_URL ?? "http://127.0.0.1:3000";
if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error("Configure CRON_SECRET com pelo menos 32 caracteres");
if (!base.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("Use HTTPS no servidor remoto");
async function tick() {
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/cron/backups`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(300000) });
    const data = await response.json();
    console.log(new Date().toISOString(), response.status, JSON.stringify(data));
  } catch (error) { console.error("Falha no agendador:", error.message); }
}
await tick();
if (!process.argv.includes("--once")) setInterval(tick, 15 * 60000);
