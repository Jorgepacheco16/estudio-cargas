ALTER TABLE "sheet_connections" ADD COLUMN "actor_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_conn_spreadsheet_uq" UNIQUE("spreadsheet_id");