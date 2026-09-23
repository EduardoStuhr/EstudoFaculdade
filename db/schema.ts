import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: text("email_verified_at"),
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const subjects = sqliteTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    // Nullable only for records that predate local accounts. New writes always set it.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    legacyOwner: text("legacy_owner"),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_subjects_user").on(table.userId)],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    legacyOwner: text("legacy_owner"),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    plainText: text("plain_text").notNull().default(""),
    legacyBlocks: text("legacy_blocks").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_notes_user_subject").on(table.userId, table.subjectId),
  ],
);

export const noteBlocks = sqliteTable(
  "note_blocks",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    content: text("content", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
  },
  (table) => [
    index("idx_note_blocks_note_position").on(table.noteId, table.position),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    legacyOwner: text("legacy_owner"),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
  },
  (table) => [
    index("idx_attachments_user_note").on(table.userId, table.noteId),
  ],
);

export const exams = sqliteTable(
  "exams",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    legacyOwner: text("legacy_owner"),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: text("date").notNull(),
    time: text("time"),
    content: text("content").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_exams_user_date").on(table.userId, table.date)],
);

export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  sessionVersion: integer("session_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_auth_tokens_expiry").on(table.expiresAt)]);

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_auth_sessions_expiry").on(table.expiresAt)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_auth_rate_limits_expiry").on(table.expiresAt)]);
