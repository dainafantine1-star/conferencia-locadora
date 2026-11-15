import { config } from "dotenv";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
const base = process.env.AUTH_URL ?? "http://127.0.0.1:3000";
if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error("Configure CRON_SECRET com pelo menos 32 caracteres");
if (!base.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("Use HTTPS no servidor remoto");
let active = false;
async function tick() {
  if (active) return;
  active = true;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/cron/atendimento`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(270000) });
    const result = await response.json();
    console.log(new Date().toISOString(), response.status, JSON.stringify(result));
  } catch { console.error("O worker não conseguiu consultar o atendimento. Confira servidor, chave e conectividade."); }
  finally { active = false; }
}
await tick();
if (!process.argv.includes("--once")) setInterval(tick, 15000);
