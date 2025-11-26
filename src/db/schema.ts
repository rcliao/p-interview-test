import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
  vector,
  decimal,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Organization/Entity metadata
export const entities = pgTable("entities", {
  id: text("id").primaryKey(), // org_id from JSON
  name: text("name"),
  type: text("type"), // 'city', 'county', 'school_district', 'special_district'
  state: text("state"),
  website: text("website"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Parent document storage
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    url: text("url").unique().notNull(),
    urlId: text("url_id").notNull(),
    orgId: text("org_id").references(() => entities.id),
    title: text("title"),
    content: text("content").notNull(),
    contentType: text("content_type"), // 'budget', 'meeting', 'rfp', 'contact', 'policy'
    summary: text("summary"),
    keywords: text("keywords").array(),
    fiscalYear: integer("fiscal_year"),
    tokenCount: integer("token_count"),
    chunkCount: integer("chunk_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("idx_documents_org").on(table.orgId)]
);

// Chunked content for vector search
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    sectionTitle: text("section_title"),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    chunkIndex: integer("chunk_index"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_chunks_document").on(table.documentId)]
);

// Project lifecycle phases
export type ProjectPhase =
  | "strategy"
  | "budget"
  | "contacts"
  | "rfp_open"
  | "awarded"
  | "in_progress";

// Extracted projects with lifecycle tracking
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").references(() => entities.id),
    title: text("title").notNull(),
    description: text("description"),

    // Lifecycle phase
    phase: text("phase").notNull().$type<ProjectPhase>(),
    phaseConfidence: real("phase_confidence"),
    phaseReasoning: text("phase_reasoning"),

    // Project details
    category: text("category"), // 'technology', 'infrastructure', 'consulting', etc.
    estimatedValue: decimal("estimated_value", { precision: 15, scale: 2 }),
    fiscalYear: integer("fiscal_year"),
    timelineNotes: text("timeline_notes"),

    // Contacts extracted from docs
    contacts: jsonb("contacts").$type<
      Array<{
        name: string;
        title?: string;
        email?: string;
        phone?: string;
        context?: string;
      }>
    >(),

    // Source tracking
    sourceDocuments: uuid("source_documents").array(),
    firstSeenAt: timestamp("first_seen_at").defaultNow(),
    lastUpdatedAt: timestamp("last_updated_at").defaultNow(),

    // Search
    embedding: vector("embedding", { dimensions: 1536 }),
    keywords: text("keywords").array(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_projects_org").on(table.orgId), index("idx_projects_phase").on(table.phase)]
);

// Project evidence linking projects to source chunks
export const projectEvidence = pgTable(
  "project_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    chunkId: uuid("chunk_id").references(() => chunks.id),
    evidenceType: text("evidence_type"), // 'phase_signal', 'budget_mention', 'contact_info', 'timeline'
    excerpt: text("excerpt"),
    confidence: real("confidence"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_evidence_project").on(table.projectId)]
);

// Chat sessions for analytics
export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  query: text("query").notNull(),
  response: text("response"),
  matchedDocs: jsonb("matched_docs"),
  matchedProjects: jsonb("matched_projects"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type exports for use in application
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProjectEvidenceRecord = typeof projectEvidence.$inferSelect;
export type NewProjectEvidence = typeof projectEvidence.$inferInsert;

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
