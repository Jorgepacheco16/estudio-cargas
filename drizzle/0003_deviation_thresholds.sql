ALTER TABLE "study_parameters" ADD COLUMN "dev_estimate_pct" numeric(5, 4) DEFAULT '0.2000' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_parameters" ADD COLUMN "dev_min_measurements" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_parameters" ADD COLUMN "dev_jump_pct" numeric(5, 4) DEFAULT '0.2500' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_parameters" ADD COLUMN "dev_min_history" smallint DEFAULT 3 NOT NULL;