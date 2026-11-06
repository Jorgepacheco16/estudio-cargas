CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"catalog" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"sections" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"base_number" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "report_versions_number_uq" UNIQUE("study_id","number"),
	CONSTRAINT "report_versions_status_ck" CHECK ("report_versions"."status" in ('draft', 'approved', 'superseded')),
	CONSTRAINT "report_versions_number_ck" CHECK ("report_versions"."number" >= 1),
	CONSTRAINT "report_versions_approval_ck" CHECK ("report_versions"."status" = 'draft' or ("report_versions"."approved_by" is not null and "report_versions"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_one_draft_uq" ON "report_versions" USING btree ("study_id") WHERE "report_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "report_versions_study_idx" ON "report_versions" USING btree ("study_id");