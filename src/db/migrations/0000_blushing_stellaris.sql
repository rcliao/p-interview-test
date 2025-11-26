CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"response" text,
	"matched_docs" jsonb,
	"matched_projects" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"section_title" text,
	"content" text NOT NULL,
	"token_count" integer,
	"chunk_index" integer,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"url_id" text NOT NULL,
	"org_id" text,
	"title" text,
	"content" text NOT NULL,
	"content_type" text,
	"summary" text,
	"keywords" text[],
	"fiscal_year" integer,
	"token_count" integer,
	"chunk_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"type" text,
	"state" text,
	"website" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"chunk_id" uuid,
	"evidence_type" text,
	"excerpt" text,
	"confidence" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text,
	"title" text NOT NULL,
	"description" text,
	"phase" text NOT NULL,
	"phase_confidence" real,
	"phase_reasoning" text,
	"category" text,
	"estimated_value" numeric(15, 2),
	"fiscal_year" integer,
	"timeline_notes" text,
	"contacts" jsonb,
	"source_documents" uuid[],
	"first_seen_at" timestamp DEFAULT now(),
	"last_updated_at" timestamp DEFAULT now(),
	"embedding" vector(1536),
	"keywords" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_entities_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_entities_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chunks_document" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_documents_org" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_evidence_project" ON "project_evidence" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_projects_org" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_projects_phase" ON "projects" USING btree ("phase");