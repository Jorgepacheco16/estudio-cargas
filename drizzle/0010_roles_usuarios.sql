CREATE TYPE "public"."app_module" AS ENUM('parametros', 'cargos', 'actividades', 'medibilidad', 'pertinencia', 'riesgos', 'oportunidades', 'rediseno', 'plan', 'historia', 'integraciones', 'agente', 'usuarios');--> statement-breakpoint
CREATE TYPE "public"."module_level" AS ENUM('none', 'read', 'edit');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"all_areas" boolean DEFAULT true NOT NULL,
	"area_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_uq" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_ck" CHECK ("invitations"."email" = lower(btrim("invitations"."email")) and position('@' in "invitations"."email") > 1)
);
--> statement-breakpoint
CREATE TABLE "member_areas" (
	"study_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "member_areas_pk" UNIQUE("study_id","user_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"module" "app_module" NOT NULL,
	"level" "module_level" NOT NULL,
	CONSTRAINT "role_permissions_pk" UNIQUE("role_id","module")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_study_name_uq" UNIQUE("study_id","name"),
	CONSTRAINT "roles_id_study_uq" UNIQUE("id","study_id"),
	CONSTRAINT "roles_name_ck" CHECK (length(btrim("roles"."name")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "all_areas" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_fk" FOREIGN KEY ("role_id","study_id") REFERENCES "public"."roles"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_member_fk" FOREIGN KEY ("study_id","user_id") REFERENCES "public"."memberships"("study_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_area_fk" FOREIGN KEY ("area_id","study_id") REFERENCES "public"."areas"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("role_id","study_id") REFERENCES "public"."roles"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("role_id","study_id") REFERENCES "public"."roles"("id","study_id") ON DELETE no action ON UPDATE no action;