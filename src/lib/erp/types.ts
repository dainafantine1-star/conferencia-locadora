export type Permission = "comercial" | "financeiro" | "logistica" | "relatorios" | "estoque" | "clientes" | "atendimento" | "fiscal";
export type CompanyPreferences = {
  legalName?: string; taxId?: string; email?: string; phone?: string; address?: string;
  contractTerms?: string; quoteValidityDays?: number;
  commissionBasis?: "recebimento" | "contrato";
  commissionBase?: "locacao" | "total";
  defaultCommissionBps?: number | null;
  backupEnabled?: boolean; backupHour?: number;
  publicUrl?: string;
};
export type StorePreferences = {
  enabled?: boolean; title?: string; description?: string; accent?: string;
  contactEmail?: string; contactPhone?: string; bannerUrl?: string; bannerTitle?: string;
  banners?: { imageUrl: string; title: string; href?: string }[];
};
export type IntegrationPreferences = {
  smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; mailFrom?: string;
  pagbankEnvironment?: "sandbox" | "production";
  whatsappPhoneId?: string; whatsappVersion?: string; whatsappTemplate?: string; whatsappLanguage?: string;
  signatureEnvironment?: "sandbox" | "production";
  signatureAuthMode?: "certificadoDigital" | "assinaturaTela-tokenEmail";
};
export type RentalLine = {
  catalogItemId: string | null; name: string; unit: string; qty: number;
  priceCents: number; periods: number;
};
export type DocumentSnapshot = {
  company: { name: string; taxId: string; address: string; email: string; phone: string };
  customer: { name: string; taxId: string; address: string; email: string; phone: string };
  lines: RentalLine[]; terms: string;
};
export type SignatureData = {
  provider?: "zapsign"; token?: string; signUrl?: string; status?: string;
  signedFileUrl?: string; documentHash?: string;
};
