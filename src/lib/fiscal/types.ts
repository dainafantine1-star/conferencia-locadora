export type FiscalEnvironment = "homologacao" | "producao";
export type FiscalAddress = { street: string; number: string; complement: string; district: string; city: string; cityCode: string; state: string; zip: string };
export type FiscalEmitter = FiscalAddress & { taxId: string; name: string; stateRegistration: string; taxRegime: 1 | 2 | 3 | 4 };
export type FiscalProfile = {
  id: string; name: string; active: boolean; reviewed: boolean; nature: string; direction: 0 | 1; purpose: 1 | 2 | 3 | 4;
  internalCfop: string; interstateCfop: string; finalConsumer: 0 | 1; buyerPresence: 0 | 1 | 2 | 3 | 9;
  freightMode: 0 | 1 | 2 | 3 | 4 | 9;
  itemTaxes: Record<string, unknown>; extraFields: Record<string, unknown>;
};
export type FiscalProduct = { catalogItemId: string; ncm: string; unit: string; origin: number; taxes: Record<string, unknown> };
export type FiscalPreferences = {
  environment: FiscalEnvironment; productionEnabled: boolean; emitter: FiscalEmitter;
  profiles: FiscalProfile[]; products: FiscalProduct[];
  whatsappTemplate: string; whatsappLanguage: string; whatsappBodyParameters: string[];
};
export type FiscalRecipient = FiscalAddress & { name: string; taxId: string; stateRegistration: string; ieIndicator: 1 | 2 | 9; phone: string; email: string };
export type FiscalItemInput = { catalogItemId: string; name: string; code: string; ncm: string; unit: string; origin: number; quantity: number; unitPriceCents: number; freightCents: number; insuranceCents: number; discountCents: number; otherCents: number };
export type FiscalDraft = { profileId: string; customerId: string; orderId: string | null; recipient: FiscalRecipient; items: FiscalItemInput[]; notes: string; referencedKey: string };
export type FiscalSnapshot = { draft: FiscalDraft; emitter: FiscalEmitter; profile: FiscalProfile; productTaxes: Record<string, Record<string, unknown>> };
export type FiscalStatus = "rascunho" | "enviando" | "processando" | "autorizada" | "rejeitada" | "incerta" | "cancelada" | "denegada";
