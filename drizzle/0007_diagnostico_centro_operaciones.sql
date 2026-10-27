ALTER TABLE "action_items" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "improvement_opportunities" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "redesign_proposals" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "actions_site_fk" FOREIGN KEY ("site_id","study_id") REFERENCES "public"."sites"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_opportunities" ADD CONSTRAINT "opportunities_site_fk" FOREIGN KEY ("site_id","study_id") REFERENCES "public"."sites"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redesign_proposals" ADD CONSTRAINT "redesign_site_fk" FOREIGN KEY ("site_id","study_id") REFERENCES "public"."sites"("id","study_id") ON DELETE no action ON UPDATE no action;