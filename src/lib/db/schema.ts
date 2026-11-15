import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  date,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
  bigint,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { AiPreferences, ActionKind } from "@/lib/assistant/types";
import type { Permission, CompanyPreferences, StorePreferences, IntegrationPreferences, RentalLine, DocumentSnapshot, SignatureData } from "@/lib/erp/types";

export const roleEnum = pgEnum("user_role", ["gestor", "operador"]);
export const orderStatusEnum = pgEnum("order_status", ["rascunho", "aberto", "encerrado", "cancelado"]);
export const billingStatusEnum = pgEnum("billing_status", [
  "sem_cobranca",
  "pendente",
  "recebida",
  "dispensada",
]);
export const labelKindEnum = pgEnum("label_kind", ["unidade", "caixa"]);

const now = () => sql`now()`;

// --- Tenant / auth ---

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Bahia"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    authVersion: integer("auth_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    permissions: jsonb("permissions").$type<Permission[]>().notNull().default([]),
    commissionBps: integer("commission_bps"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    uniqueIndex("memberships_user_company_key").on(t.userId, t.companyId),
    index("memberships_company_idx").on(t.companyId),
  ],
);

// --- Catálogo / clientes ---

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    taxId: text("tax_id").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index("customers_company_idx").on(t.companyId)],
);

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("un"),
    stockQty: integer("stock_qty"),
    unavailableQty: integer("unavailable_qty").notNull().default(0),
    rentalPriceCents: integer("rental_price_cents"),
    priceUnit: text("price_unit").notNull().default("evento"),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    published: boolean("published").notNull().default(false),
    featured: boolean("featured").notNull().default(false),
    // centavos inteiros
    replacementCents: integer("replacement_cents").notNull(),
    damageCents: integer("damage_cents"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index("catalog_items_company_idx").on(t.companyId)],
);

/**
 * Etiquetas para bipagem (QR/código de barras).
 * - unidade: 1 código por peça física; cada bipagem conta 1
 * - caixa: 1 código por caixa/kit; cada bipagem conta `qty` unidades
 */
export const scanLabels = pgTable(
  "scan_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: labelKindEnum("kind").notNull().default("unidade"),
    qty: integer("qty").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    uniqueIndex("scan_labels_company_code_key").on(t.companyId, t.code),
    index("scan_labels_catalog_idx").on(t.catalogItemId),
  ],
);

// --- Pedidos ---

export const agendaSlots = pgTable("agenda_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  hour: text("hour").notNull(),
  capacity: integer("capacity").notNull(),
  booked: integer("booked").notNull().default(0),
}, (t) => [uniqueIndex("agenda_slots_company_day_hour_key").on(t.companyId, t.day, t.hour)]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    eventName: text("event_name").notNull(),
    eventDate: date("event_date").notNull(),
    returnDueDate: date("return_due_date").notNull(),
    status: orderStatusEnum("status").notNull().default("rascunho"),
    billingStatus: billingStatusEnum("billing_status").notNull().default("sem_cobranca"),
    exitConfirmedAt: timestamp("exit_confirmed_at", { withTimezone: true }),
    exitConfirmedBy: uuid("exit_confirmed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    // último fechamento ativo (reabertura cria novo registro em closures)
    activeClosureId: uuid("active_closure_id"),
    notes: text("notes").default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now())
      .$onUpdate(() => now()),
  },
  (t) => [
    uniqueIndex("orders_company_number_key").on(t.companyId, t.number),
    index("orders_company_status_idx").on(t.companyId, t.status),
    index("orders_company_due_idx").on(t.companyId, t.returnDueDate),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id, {
      onDelete: "set null",
    }),
    // snapshot do catálogo no momento do pedido
    name: text("name").notNull(),
    unit: text("unit").notNull().default("un"),
    qtyPlanned: integer("qty_planned").notNull(),
    qtyDelivered: integer("qty_delivered"),
    // valores em centavos; copiados na confirmação de saída
    replacementCents: integer("replacement_cents"),
    damageCents: integer("damage_cents"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// --- Devoluções ---

export const returns = pgTable(
  "returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(now()),
    notes: text("notes").default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    // idempotência: reenvios repetidos não duplicam
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index("returns_order_idx").on(t.orderId),
    uniqueIndex("returns_idempotency_key").on(t.idempotencyKey).where(
      sql`idempotency_key IS NOT NULL`,
    ),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    qtyGood: integer("qty_good").notNull().default(0),
    qtyDamaged: integer("qty_damaged").notNull().default(0),
  },
  (t) => [uniqueIndex("return_items_return_item_key").on(t.returnId, t.orderItemId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    returnId: uuid("return_id").references(() => returns.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storedName: text("stored_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index("attachments_return_idx").on(t.returnId), index("attachments_order_idx").on(t.orderId)],
);

// --- Fechamento / cobrança ---

export const closures = pgTable(
  "closures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().default(now()),
    closedBy: uuid("closed_by")
      .notNull()
      .references(() => users.id),
    // snapshot dos saldos no fechamento
    missingQty: integer("missing_qty").notNull().default(0),
    damagedQty: integer("damaged_qty").notNull().default(0),
    goodQty: integer("good_qty").notNull().default(0),
    suggestedCents: integer("suggested_cents").notNull().default(0),
    finalCents: integer("final_cents").notNull().default(0),
    adjustmentCents: integer("adjustment_cents").notNull().default(0),
    adjustmentReason: text("adjustment_reason"),
    adjustedBy: uuid("adjusted_by").references(() => users.id),
    adjustedAt: timestamp("adjusted_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedBy: uuid("reopened_by").references(() => users.id),
    itemsSnapshot: jsonb("items_snapshot").notNull().default("[]"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("closures_order_idx").on(t.orderId)],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: billingStatusEnum("status").notNull(),
    amountCents: integer("amount_cents"),
    note: text("note").default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index("billing_events_order_idx").on(t.orderId)],
);

// --- Histórico simples de operações ---

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    payload: jsonb("payload").default("{}"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index("audit_log_company_idx").on(t.companyId), index("audit_log_order_idx").on(t.orderId)],
);

// --- Relações (para joins type-safe) ---

export const companiesRelations = relations(companies, ({ many }) => ({
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  company: one(companies, { fields: [memberships.companyId], references: [companies.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  company: one(companies, { fields: [orders.companyId], references: [companies.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  returns: many(returns),
  closures: many(closures),
  billingEvents: many(billingEvents),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  catalogItem: one(catalogItems, {
    fields: [orderItems.catalogItemId],
    references: [catalogItems.id],
  }),
  returnItems: many(returnItems),
}));

export const returnsRelations = relations(returns, ({ one, many }) => ({
  order: one(orders, { fields: [returns.orderId], references: [orders.id] }),
  items: many(returnItems),
  attachments: many(attachments),
}));

export const returnItemsRelations = relations(returnItems, ({ one }) => ({
  returnRecord: one(returns, { fields: [returnItems.returnId], references: [returns.id] }),
  orderItem: one(orderItems, { fields: [returnItems.orderItemId], references: [orderItems.id] }),
}));

export const closuresRelations = relations(closures, ({ one }) => ({
  order: one(orders, { fields: [closures.orderId], references: [orders.id] }),
}));

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
  order: one(orders, { fields: [billingEvents.orderId], references: [orders.id] }),
}));

export const scanLabelsRelations = relations(scanLabels, ({ one }) => ({
  company: one(companies, { fields: [scanLabels.companyId], references: [companies.id] }),
  catalogItem: one(catalogItems, {
    fields: [scanLabels.catalogItemId],
    references: [catalogItems.id],
  }),
}));

// --- Gestão comercial, financeira e site integrado ---
export const companySettings = pgTable("company_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  slug: text("slug"),
  preferences: jsonb("preferences").$type<CompanyPreferences>().notNull().default({}),
  storefront: jsonb("storefront").$type<StorePreferences>().notNull().default({}),
  integrations: jsonb("integrations").$type<IntegrationPreferences>().notNull().default({}),
  encryptedSecrets: text("encrypted_secrets"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("company_settings_slug_key").on(t.slug)]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), taxId: text("tax_id").notNull().default(""),
  email: text("email").notNull().default(""), phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""), notes: text("notes").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("suppliers_company_idx").on(t.companyId)]);

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  catalogItemId: uuid("catalog_item_id").notNull().references(() => catalogItems.id),
  kind: text("kind").notNull(), delta: integer("delta").notNull().default(0),
  unavailableDelta: integer("unavailable_delta").notNull().default(0),
  reason: text("reason").notNull(), referenceId: uuid("reference_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("stock_movements_company_item_idx").on(t.companyId, t.catalogItemId)]);

export const rentalDocuments = pgTable("rental_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), status: text("status").notNull().default("rascunho"),
  number: integer("number").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  sellerId: uuid("seller_id").references(() => users.id),
  orderId: uuid("order_id").references(() => orders.id), parentId: uuid("parent_id"),
  eventName: text("event_name").notNull(), eventDate: date("event_date").notNull(), returnDueDate: date("return_due_date").notNull(),
  validUntil: date("valid_until"),
  lines: jsonb("lines").$type<RentalLine[]>().notNull(),
  subtotalCents: integer("subtotal_cents").notNull(), deliveryCents: integer("delivery_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0), totalCents: integer("total_cents").notNull(),
  terms: text("terms").notNull().default(""), notes: text("notes").notNull().default(""),
  deliveryAddress: text("delivery_address").notNull().default(""),
  commissionBps: integer("commission_bps"), commissionBasis: text("commission_basis"),
  commissionBaseCents: integer("commission_base_cents"),
  snapshot: jsonb("snapshot").$type<DocumentSnapshot>(),
  shareTokenHash: text("share_token_hash"), shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
  signature: jsonb("signature").$type<SignatureData>(), signedAt: timestamp("signed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("rental_documents_number_key").on(t.companyId, t.kind, t.number),
  uniqueIndex("rental_documents_order_key").on(t.orderId),
  uniqueIndex("rental_documents_share_key").on(t.shareTokenHash), index("rental_documents_company_idx").on(t.companyId)]);

export const financialEntries = pgTable("financial_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), description: text("description").notNull(), category: text("category").notNull().default("geral"),
  customerId: uuid("customer_id").references(() => customers.id), supplierId: uuid("supplier_id").references(() => suppliers.id),
  documentId: uuid("document_id").references(() => rentalDocuments.id), installment: integer("installment"),
  closureId: uuid("closure_id").references(() => closures.id),
  amountCents: integer("amount_cents").notNull(), dueDate: date("due_date").notNull(),
  creditedCents: integer("credited_cents").notNull().default(0),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }), cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("financial_entries_company_due_idx").on(t.companyId, t.dueDate),
  uniqueIndex("financial_entries_document_installment_key").on(t.documentId, t.installment),
  uniqueIndex("financial_entries_closure_key").on(t.closureId)]);

export const settlements = pgTable("settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => financialEntries.id),
  amountCents: integer("amount_cents").notNull(), method: text("method").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(now()),
  note: text("note").notNull().default(""), idempotencyKey: text("idempotency_key").notNull(),
  reversalOf: uuid("reversal_of"), providerId: text("provider_id"),
  receiptNumber: text("receipt_number").notNull(), receiptSnapshot: jsonb("receipt_snapshot").notNull().default({}),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("settlements_idempotency_key").on(t.companyId, t.idempotencyKey),
  uniqueIndex("settlements_provider_key").on(t.providerId), index("settlements_entry_idx").on(t.entryId)]);

export const commissions = pgTable("commissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => rentalDocuments.id),
  sellerId: uuid("seller_id").notNull().references(() => users.id),
  settlementId: uuid("settlement_id").references(() => settlements.id),
  amountCents: integer("amount_cents").notNull(), rateBps: integer("rate_bps").notNull(),
  basis: text("basis").notNull(), status: text("status").notNull().default("pendente"),
  paidAt: timestamp("paid_at", { withTimezone: true }), paidBy: uuid("paid_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("commissions_settlement_key").on(t.settlementId), index("commissions_company_seller_idx").on(t.companyId, t.sellerId)]);

export const logisticsTasks = pgTable("logistics_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  kind: text("kind").notNull(), status: text("status").notNull().default("agendada"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  address: text("address").notNull(), contact: text("contact").notNull().default(""),
  assigneeId: uuid("assignee_id").references(() => users.id), vehicle: text("vehicle").notNull().default(""),
  notes: text("notes").notNull().default(""), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("logistics_company_schedule_idx").on(t.companyId, t.scheduledAt)]);

export const storePages = pgTable("store_pages", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(), title: text("title").notNull(), content: text("content").notNull(),
  published: boolean("published").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("store_pages_slug_key").on(t.companyId, t.slug)]);

export const storeLeads = pgTable("store_leads", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), status: text("status").notNull().default("novo"),
  name: text("name").notNull(), email: text("email").notNull(), phone: text("phone").notNull().default(""),
  message: text("message").notNull().default(""),
  eventDate: date("event_date"), returnDueDate: date("return_due_date"),
  items: jsonb("items").$type<{ catalogItemId: string; qty: number }[]>().notNull().default([]),
  documentId: uuid("document_id").references(() => rentalDocuments.id),
  requestKey: text("request_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("store_leads_request_key").on(t.companyId, t.requestKey), index("store_leads_company_idx").on(t.companyId)]);

export const messageLog = pgTable("message_log", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), recipient: text("recipient").notNull(),
  subject: text("subject").notNull(), status: text("status").notNull(),
  providerId: text("provider_id"), error: text("error"), documentId: uuid("document_id"),
  requestKey: text("request_key"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("message_log_company_idx").on(t.companyId), uniqueIndex("message_log_request_key").on(t.companyId, t.requestKey)]);

export const requestLimits = pgTable("request_limits", {
  key: text("key").primaryKey(), hits: integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const holidays = pgTable("holidays", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  day: date("day").notNull(), name: text("name").notNull(), source: text("source").notNull().default("manual"),
}, t => [uniqueIndex("holidays_company_day_name_key").on(t.companyId, t.day, t.name)]);

export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull(), storageKey: text("storage_key"), checksum: text("checksum"), error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("backup_runs_company_idx").on(t.companyId)]);

export const paymentCheckouts = pgTable("payment_checkouts", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => financialEntries.id),
  providerId: text("provider_id"), url: text("url"), amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("criando"), error: text("error"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("payment_checkouts_provider_key").on(t.providerId), index("payment_checkouts_entry_idx").on(t.entryId)]);

export type Company = typeof companies.$inferSelect;
// Assistência e atendimento: armazenamento próprio, com isolamento por empresa.
export const aiSettings = pgTable("ai_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").$type<AiPreferences>().notNull().default({}),
  encryptedSecrets: text("encrypted_secrets"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [
  uniqueIndex("ai_settings_meta_phone_key").on(sql`(${t.preferences}->>'phoneId')`).where(sql`${t.preferences}->>'whatsappProvider' = 'meta' and ${t.preferences}->>'phoneId' <> ''`),
  uniqueIndex("ai_settings_waha_session_key").on(sql`(${t.preferences}->>'wahaUrl')`, sql`(${t.preferences}->>'wahaSession')`).where(sql`${t.preferences}->>'whatsappProvider' = 'waha' and ${t.preferences}->>'wahaSession' <> ''`),
]);
export const aiAgents = pgTable("ai_agents", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(), instructions: text("instructions").notNull().default(""),
  channel: text("channel").notNull().default("interno"), mode: text("mode").notNull().default("assistido"),
  active: boolean("active").notNull().default(false), version: integer("version").notNull().default(1),
  keywords: jsonb("keywords").$type<string[]>().notNull().default(["atendente", "humano"]),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("ai_agents_company_idx").on(t.companyId)]);
export const aiKnowledge = pgTable("ai_knowledge", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  title: text("title").notNull(), content: text("content").notNull(), audience: text("audience").notNull().default("interno"),
  active: boolean("active").notNull().default(true), createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("ai_knowledge_company_idx").on(t.companyId)]);
export const aiThreads = pgTable("ai_threads", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  userId: uuid("user_id").references(() => users.id), channel: text("channel").notNull(),
  externalKey: text("external_key"), name: text("name").notNull().default(""), phone: text("phone"),
  status: text("status").notNull().default("aberto"), assignedTo: uuid("assigned_to").references(() => users.id),
  optedOut: boolean("opted_out").notNull().default(false), lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("ai_threads_external_key").on(t.companyId, t.channel, t.externalKey), index("ai_threads_company_idx").on(t.companyId)]);
export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  threadId: uuid("thread_id").notNull().references(() => aiThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(), content: text("content").notNull(), status: text("status").notNull().default("registrado"),
  externalId: text("external_id"), requestKey: text("request_key"), error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("ai_messages_external_key").on(t.companyId, t.externalId), uniqueIndex("ai_messages_request_key").on(t.companyId, t.requestKey), index("ai_messages_thread_idx").on(t.threadId, t.createdAt)]);
export const aiActions = pgTable("ai_actions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  userId: uuid("user_id").notNull().references(() => users.id), threadId: uuid("thread_id").notNull().references(() => aiThreads.id),
  kind: text("kind").$type<ActionKind>().notNull(), title: text("title").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pendente"), result: jsonb("result"), error: text("error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("ai_actions_thread_idx").on(t.threadId)]);
export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  threadId: uuid("thread_id").references(() => aiThreads.id), agentId: uuid("agent_id").references(() => aiAgents.id),
  userId: uuid("user_id").references(() => users.id), model: text("model").notNull(),
  status: text("status").notNull().default("executando"), inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [index("ai_runs_company_idx").on(t.companyId, t.createdAt)]);
export const aiRules = pgTable("ai_rules", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(), active: boolean("active").notNull().default(false),
  trigger: text("trigger").notNull(), keyword: text("keyword").notNull().default(""),
  delayMinutes: integer("delay_minutes").notNull().default(0), action: text("action").notNull(),
  text: text("text").notNull().default(""), createdBy: uuid("created_by").notNull().references(() => users.id),
}, t => [index("ai_rules_company_idx").on(t.companyId)]);
export const aiJobs = pgTable("ai_jobs", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  threadId: uuid("thread_id").notNull().references(() => aiThreads.id), messageId: uuid("message_id").references(() => aiMessages.id),
  ruleId: uuid("rule_id").references(() => aiRules.id), kind: text("kind").notNull(),
  requestKey: text("request_key").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("aguardando"), error: text("error"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().default(now()), startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("ai_jobs_request_key").on(t.companyId, t.requestKey), index("ai_jobs_due_idx").on(t.status, t.dueAt)]);

export const aiDeliveries = pgTable("ai_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  externalId: text("external_id").notNull(), status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("ai_deliveries_external_key").on(t.companyId, t.externalId)]);

// Documentos fiscais usam referência estável e não alteram contas ou estoque da locação.
export const fiscalSettings = pgTable("fiscal_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id),
  preferences: jsonb("preferences").$type<import("@/lib/fiscal/types").FiscalPreferences>().notNull(),
  encryptedSecrets: text("encrypted_secrets"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
});
export const fiscalInvoices = pgTable("fiscal_invoices", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id), orderId: uuid("order_id").references(() => orders.id),
  requestKey: text("request_key").notNull(), environment: text("environment").$type<import("@/lib/fiscal/types").FiscalEnvironment>().notNull(),
  reference: text("reference").notNull(), revision: integer("revision").notNull().default(1),
  status: text("status").$type<import("@/lib/fiscal/types").FiscalStatus>().notNull().default("rascunho"),
  snapshot: jsonb("snapshot").$type<import("@/lib/fiscal/types").FiscalSnapshot>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(), productsCents: integer("products_cents").notNull(),
  providerStatus: text("provider_status"), number: text("number"), series: text("series"), accessKey: text("access_key"), protocol: text("protocol"),
  pdfPath: text("pdf_path"), xmlPath: text("xml_path"), message: text("message"),
  pdfData: text("pdf_data"), xmlData: text("xml_data"), pdfSha256: text("pdf_sha256"), xmlSha256: text("xml_sha256"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }), checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("fiscal_invoices_request_key").on(t.companyId, t.requestKey), uniqueIndex("fiscal_invoices_reference_key").on(t.reference), index("fiscal_invoices_company_idx").on(t.companyId, t.createdAt)]);
export const fiscalDeliveries = pgTable("fiscal_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  invoiceId: uuid("invoice_id").notNull().references(() => fiscalInvoices.id), requestKey: text("request_key").notNull(),
  recipient: text("recipient").notNull(), status: text("status").notNull(), providerId: text("provider_id"), error: text("error"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now()),
}, t => [uniqueIndex("fiscal_deliveries_request_key").on(t.companyId, t.requestKey), index("fiscal_deliveries_invoice_idx").on(t.companyId, t.invoiceId)]);

export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type ReturnRecord = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Closure = typeof closures.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type ScanLabel = typeof scanLabels.$inferSelect;
