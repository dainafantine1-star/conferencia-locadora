export type AiProvider = "gateway" | "openai" | "anthropic" | "google" | "openrouter";
export type AiPreferences = {
  provider?: AiProvider; model?: string; dailyRuns?: number; maxOutputTokens?: number;
  whatsappProvider?: "meta" | "waha"; phoneId?: string; graphVersion?: string;
  wahaUrl?: string; wahaSession?: string; startHour?: number; endHour?: number;
  dailyMessages?: number; retentionDays?: number;
};
export type AiSecret = "aiKey" | "metaToken" | "metaAppSecret" | "verifyToken" | "wahaKey" | "wahaWebhookSecret";
export type ActionKind = "create_quote" | "create_customer" | "send_document" | "system_command";
export type HelpArticle = { id: string; title: string; href: string; text: string; permission?: string };
