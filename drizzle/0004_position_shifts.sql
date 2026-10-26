CREATE TABLE "activity_shifts" (
	"study_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	CONSTRAINT "activity_shifts_pk" UNIQUE("activity_id","shift_id")
);
--> statement-breakpoint
CREATE TABLE "position_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" time,
	"end_time" time,
	"break_minutes" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_shifts_id_study_uq" UNIQUE("id","study_id"),
	CONSTRAINT "position_shifts_name_uq" UNIQUE("position_id","name"),
	CONSTRAINT "position_shifts_name_ck" CHECK (length(btrim("position_shifts"."name")) > 0),
	CONSTRAINT "position_shifts_break_ck" CHECK ("position_shifts"."break_minutes" is null or "position_shifts"."break_minutes" between 0 and 240)
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "all_shifts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_shifts" ADD CONSTRAINT "activity_shifts_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_shifts" ADD CONSTRAINT "activity_shifts_activity_fk" FOREIGN KEY ("activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_shifts" ADD CONSTRAINT "activity_shifts_shift_fk" FOREIGN KEY ("shift_id","study_id") REFERENCES "public"."position_shifts"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_shifts" ADD CONSTRAINT "position_shifts_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_shifts" ADD CONSTRAINT "position_shifts_position_fk" FOREIGN KEY ("position_id","study_id") REFERENCES "public"."positions"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_shifts_shift_idx" ON "activity_shifts" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "position_shifts_position_idx" ON "position_shifts" USING btree ("position_id");