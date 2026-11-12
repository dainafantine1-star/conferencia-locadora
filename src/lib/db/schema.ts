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

export const roleEnum = pgEnum("user_role", ["gestor", "operador"]);
export const orderStatusEnum = pgEnum("order_status", ["rascunho", "aberto", "encerrado"]);
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

export type Company = typeof companies.$inferSelect;
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
