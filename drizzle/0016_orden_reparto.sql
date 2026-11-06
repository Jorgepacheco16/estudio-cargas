CREATE TABLE "schedule_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"position_key" text NOT NULL,
	"week_kind" text NOT NULL,
	"person" smallint NOT NULL,
	"day" smallint NOT NULL,
	"codes" text[] NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_orders_uq" UNIQUE("study_id","position_key","week_kind","person","day"),
	CONSTRAINT "schedule_orders_key_ck" CHECK (length("schedule_orders"."position_key") between 1 and 400),
	CONSTRAINT "schedule_orders_week_ck" CHECK ("schedule_orders"."week_kind" in ('common', 'periodic')),
	CONSTRAINT "schedule_orders_person_ck" CHECK ("schedule_orders"."person" between 1 and 200),
	CONSTRAINT "schedule_orders_day_ck" CHECK ("schedule_orders"."day" between 0 and 6),
	CONSTRAINT "schedule_orders_codes_ck" CHECK (cardinality("schedule_orders"."codes") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "schedule_orders" ADD CONSTRAINT "schedule_orders_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_orders_study_idx" ON "schedule_orders" USING btree ("study_id");