import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const device = pgTable("device", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  quotaOverride: integer("quota_override"),
});

export const turn = pgTable("turn", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => device.id),
  origin: text("origin").notNull(),
  tier: text("tier", { enum: ["observe", "control"] }).notNull(),
  taskText: text("task_text").notNull(),
  status: text("status", {
    enum: ["running", "completed", "failed", "refused", "stopped"],
  }).notNull(),
  counted: boolean("counted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const trajectory = pgTable(
  "trajectory",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turn.id),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.turnId, table.seq)],
);

export const deviceUsage = pgTable(
  "device_usage",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => device.id),
    day: date("day").notNull(),
    used: integer("used").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.day] })],
);

export const ipUsage = pgTable(
  "ip_usage",
  {
    ipHash: text("ip_hash").notNull(),
    day: date("day").notNull(),
    used: integer("used").notNull().default(0),
    registrations: integer("registrations").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ipHash, table.day] })],
);

export const confirmation = pgTable("confirmation", {
  actionId: uuid("action_id").primaryKey(),
  turnId: uuid("turn_id")
    .notNull()
    .references(() => turn.id),
  paramsHash: text("params_hash").notNull(),
  approved: boolean("approved").notNull(),
  consumed: boolean("consumed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
