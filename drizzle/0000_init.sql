CREATE TYPE "public"."activity_type" AS ENUM('operational', 'administrative', 'control', 'coordination', 'service', 'support', 'occasional');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('owner', 'editor', 'analyst', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('drafting', 'validated_by_owner', 'approved_by_management', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."calc_mode" AS ENUM('per_event', 'per_unit');--> statement-breakpoint
CREATE TYPE "public"."compatibility" AS ENUM('compatible', 'partial', 'incompatible');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."correspondence" AS ENUM('high', 'partial', 'low', 'none');--> statement-breakpoint
CREATE TYPE "public"."data_kind" AS ENUM('real', 'demo');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('declared_by_employee', 'declared_by_manager', 'observed', 'timed', 'verifiable_source', 'validated_estimate');--> statement-breakpoint
CREATE TYPE "public"."exec_scope" AS ENUM('per_employee', 'position_total');--> statement-breakpoint
CREATE TYPE "public"."finding_class" AS ENUM('confirmed', 'hypothesis', 'pending_recommendation');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'occasional', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."indicator_kind" AS ENUM('cycle_time', 'units_per_hour', 'on_time_pct', 'error_pct', 'rework_rate', 'record_accuracy', 'service_level', 'control_compliance', 'response_time', 'qualitative_criterion');--> statement-breakpoint
CREATE TYPE "public"."info_source" AS ENUM('interview_employee', 'interview_manager', 'direct_observation', 'procedures_review', 'records_systems', 'timing');--> statement-breakpoint
CREATE TYPE "public"."initiative_type" AS ENUM('quick_win', 'investment', 'tech_adjustment', 'training', 'org_change');--> statement-breakpoint
CREATE TYPE "public"."level3" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."measure_unit" AS ENUM('minutes_per_execution', 'units_per_hour', 'on_time_pct', 'error_pct', 'rework_rate', 'record_accuracy', 'service_level', 'control_compliance', 'response_time', 'qualitative_criterion');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('keep', 'eliminate', 'simplify', 'standardize', 'automate', 'redistribute', 'group', 'create_specialized_role', 'train', 'document', 'reduce_waits_rework', 'improve_controls');--> statement-breakpoint
CREATE TYPE "public"."period_unit" AS ENUM('day', 'week', 'fortnight', 'month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('not_started', 'in_progress', 'completed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."planning" AS ENUM('planned', 'unplanned');--> statement-breakpoint
CREATE TYPE "public"."potential" AS ENUM('high', 'medium', 'low', 'none');--> statement-breakpoint
CREATE TYPE "public"."reassignment" AS ENUM('yes', 'conditional', 'no');--> statement-breakpoint
CREATE TYPE "public"."scenario" AS ENUM('base', 'high_season', 'low_season', 'min_time', 'max_time');--> statement-breakpoint
CREATE TYPE "public"."situation" AS ENUM('s1_train', 's2_not_in_purpose', 's3_specialization', 's4_simplify_automate', 'none');--> statement-breakpoint
CREATE TYPE "public"."tri_state" AS ENUM('yes', 'partial', 'no');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('pending', 'in_validation', 'validated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."value_class" AS ENUM('direct_value', 'necessary_no_direct_value', 'dispensable');--> statement-breakpoint
CREATE TYPE "public"."yes_no_ne" AS ENUM('yes', 'no', 'not_evaluated');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"data_kind" "data_kind" DEFAULT 'real' NOT NULL,
	"code" text NOT NULL,
	"finding" text,
	"action" text NOT NULL,
	"area_id" uuid,
	"position_name" text,
	"resources" text,
	"estimated_cost" numeric(16, 2),
	"priority" "level3",
	"initiative_type" "initiative_type",
	"start_date" date,
	"end_date" date,
	"dependencies" text,
	"risks" text,
	"result_indicator" text,
	"target" numeric(18, 4),
	"status" "plan_status",
	"actual_result" numeric(18, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "actions_study_code_uq" UNIQUE("study_id","code"),
	CONSTRAINT "actions_dates_ck" CHECK ("action_items"."end_date" is null or "action_items"."start_date" is null or "action_items"."end_date" >= "action_items"."start_date")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"data_kind" "data_kind" DEFAULT 'real' NOT NULL,
	"code" text NOT NULL,
	"position_id" uuid NOT NULL,
	"employee_code" text,
	"name" text NOT NULL,
	"description" text,
	"process" text,
	"objective_result" text,
	"other_positions" text,
	"formally_documented" "tri_state",
	"frequency" "frequency",
	"calc_mode" "calc_mode",
	"executions_per_period" numeric(14, 4),
	"period" "period_unit",
	"scope" "exec_scope",
	"units_per_execution" numeric(14, 4),
	"time_avg_min" numeric(12, 4),
	"time_min_min" numeric(12, 4),
	"time_max_min" numeric(12, 4),
	"season_high_factor" numeric(6, 3),
	"season_low_factor" numeric(6, 3),
	"data_source" "data_source",
	"confidence" "confidence",
	"simultaneous_people" integer,
	"load_share_pct" numeric(5, 4),
	"secondary_position_id" uuid,
	"planning" "planning",
	"tools" text,
	"inputs" text,
	"deliverable" text,
	"dependencies" text,
	"wait_min" numeric(12, 4),
	"wait_occupies_person" boolean,
	"travel_min" numeric(12, 4),
	"rework_pct" numeric(5, 4),
	"rework_min" numeric(12, 4),
	"consequences" text,
	"controls" text,
	"activity_type" "activity_type",
	"value_class" "value_class",
	"mandatory" boolean,
	"standardization_potential" "potential",
	"simplification_potential" "potential",
	"automation_potential" "potential",
	"integration_possible" "yes_no_ne",
	"evidence" text,
	"notes" text,
	"pending_validation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "activities_study_code_uq" UNIQUE("study_id","code"),
	CONSTRAINT "activities_id_study_uq" UNIQUE("id","study_id"),
	CONSTRAINT "activities_code_ck" CHECK (length(btrim("activities"."code")) > 0),
	CONSTRAINT "activities_ranges_ck" CHECK (
    ("activities"."executions_per_period" is null or "activities"."executions_per_period" >= 0) and ("activities"."units_per_execution" is null or "activities"."units_per_execution" >= 0)
    and ("activities"."time_avg_min" is null or "activities"."time_avg_min" >= 0) and ("activities"."time_min_min" is null or "activities"."time_min_min" >= 0) and ("activities"."time_max_min" is null or "activities"."time_max_min" >= 0)
    and ("activities"."season_high_factor" is null or "activities"."season_high_factor" between 0 and 10) and ("activities"."season_low_factor" is null or "activities"."season_low_factor" between 0 and 10)
    and ("activities"."simultaneous_people" is null or "activities"."simultaneous_people" between 1 and 50)
    and ("activities"."load_share_pct" is null or "activities"."load_share_pct" between 0 and 1) and ("activities"."rework_pct" is null or "activities"."rework_pct" between 0 and 1)
    and ("activities"."wait_min" is null or "activities"."wait_min" >= 0) and ("activities"."travel_min" is null or "activities"."travel_min" >= 0) and ("activities"."rework_min" is null or "activities"."rework_min" >= 0))
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "areas_study_name_uq" UNIQUE("study_id","name"),
	CONSTRAINT "areas_id_study_uq" UNIQUE("id","study_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_id" uuid NOT NULL,
	"actor_id" uuid,
	"origin" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"baseline" jsonb NOT NULL,
	"observed" jsonb NOT NULL,
	"explanation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"data_kind" "data_kind" DEFAULT 'real' NOT NULL,
	"code" text NOT NULL,
	"type" "opportunity_type",
	"finding_class" "finding_class",
	"problem" text,
	"related_activity_id" uuid,
	"evidence" text,
	"probable_cause" text,
	"proposal" text,
	"area_id" uuid,
	"position_name" text,
	"expected_benefit" text,
	"recoverable_hours_per_week" numeric(10, 2),
	"impact_assumptions" text,
	"implementation_risks" text,
	"impact_score" smallint,
	"ease_score" smallint,
	"effort_score" smallint,
	"cost_score" smallint,
	"risk_score" smallint,
	"owner" text,
	"due_date" date,
	"follow_up_indicator" text,
	"validation_status" "validation_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "opportunities_study_code_uq" UNIQUE("study_id","code"),
	CONSTRAINT "opportunities_scales_ck" CHECK (coalesce("improvement_opportunities"."impact_score",1) between 1 and 5 and coalesce("improvement_opportunities"."ease_score",1) between 1 and 5 and coalesce("improvement_opportunities"."effort_score",1) between 1 and 5 and coalesce("improvement_opportunities"."cost_score",1) between 1 and 5 and coalesce("improvement_opportunities"."risk_score",1) between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "measurability_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"direct_measurement" "tri_state",
	"has_indicators" boolean,
	"has_history" "tri_state",
	"has_time_standard" boolean,
	"source_reliability" "level3",
	"external_dependency" "level3",
	"result_verifiable" "tri_state",
	"recommended_unit" "measure_unit",
	"proposed_indicator" "indicator_kind",
	"qualitative_criterion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "measurability_activity_uq" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"units_processed" numeric(14, 4),
	"person_hours" numeric(10, 4) NOT NULL,
	"method" "data_source" NOT NULL,
	"observer" text,
	CONSTRAINT "measurements_hours_ck" CHECK ("measurements"."person_hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_study_user_uq" UNIQUE("study_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data_kind" "data_kind" DEFAULT 'real' NOT NULL,
	"boss" text,
	"objective" text,
	"formal_functions" text,
	"auto_created" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "positions_key_uq" UNIQUE("study_id","area_id","site_id","name","data_kind"),
	CONSTRAINT "positions_id_study_uq" UNIQUE("id","study_id")
);
--> statement-breakpoint
CREATE TABLE "redesign_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"data_kind" "data_kind" DEFAULT 'real' NOT NULL,
	"area_id" uuid NOT NULL,
	"current_position_name" text NOT NULL,
	"current_objective" text,
	"current_functions" text,
	"kept_activities" text,
	"modified_activities" text,
	"removed_activities" text,
	"transferred_activities" text,
	"receiving_position_name" text,
	"new_responsibilities" text,
	"limits_and_authority" text,
	"required_competencies" text,
	"training_needs" text,
	"performance_indicators" text,
	"reporting_lines" text,
	"hours_out_per_week" numeric(10, 2),
	"hours_in_per_week" numeric(10, 2),
	"hours_recovered_per_week" numeric(10, 2),
	"justification" text,
	"expected_benefits" text,
	"risks_and_conditions" text,
	"approval_status" "approval_status" DEFAULT 'drafting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "redesign_study_area_position_uq" UNIQUE("study_id","data_kind","area_id","current_position_name")
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"risk" text,
	"consequences" text,
	"impact_operational" smallint,
	"impact_economic" smallint,
	"impact_labor" smallint,
	"impact_legal" smallint,
	"impact_service" smallint,
	"probability" smallint,
	"controls" text,
	"evidence" text,
	"dependencies" text,
	"people_who_can_execute" integer,
	"duplications" text,
	"function_incompatibility" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "risk_activity_uq" UNIQUE("activity_id"),
	CONSTRAINT "risk_scales_ck" CHECK (coalesce("risk_assessments"."impact_operational",1) between 1 and 5 and coalesce("risk_assessments"."impact_economic",1) between 1 and 5 and coalesce("risk_assessments"."impact_labor",1) between 1 and 5 and coalesce("risk_assessments"."impact_legal",1) between 1 and 5 and coalesce("risk_assessments"."impact_service",1) between 1 and 5 and coalesce("risk_assessments"."probability",1) between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "sheet_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"status" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sheet_conn_study_sheet_uq" UNIQUE("study_id","spreadsheet_id")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"name" text NOT NULL,
	"regional" text,
	CONSTRAINT "sites_study_name_uq" UNIQUE("study_id","name"),
	CONSTRAINT "sites_id_study_uq" UNIQUE("id","study_id")
);
--> statement-breakpoint
CREATE TABLE "staffing_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"headcount" integer,
	"employee_code" text,
	"weekly_hours" numeric(5, 2),
	"survey_date" date,
	"surveyor" text,
	"info_source" "info_source",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staffing_ranges_ck" CHECK (("staffing_entries"."headcount" is null or "staffing_entries"."headcount" between 0 and 500) and ("staffing_entries"."weekly_hours" is null or "staffing_entries"."weekly_hours" between 0 and 84))
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_parameters" (
	"study_id" uuid PRIMARY KEY NOT NULL,
	"work_days_per_week" numeric(4, 2) DEFAULT '6' NOT NULL,
	"weeks_per_month" numeric(10, 6) DEFAULT '4.333333' NOT NULL,
	"weeks_per_year" integer DEFAULT 52 NOT NULL,
	"reserve_pct" numeric(5, 4) DEFAULT '0.1000' NOT NULL,
	"overload_threshold" numeric(5, 4) DEFAULT '1.0000' NOT NULL,
	"low_load_threshold" numeric(5, 4) DEFAULT '0.5000' NOT NULL,
	"hourly_cost_cop" numeric(14, 2),
	"scenario" "scenario" DEFAULT 'base' NOT NULL,
	"assumptions_validated" boolean DEFAULT false NOT NULL,
	"weight_impact" smallint DEFAULT 3 NOT NULL,
	"weight_ease" smallint DEFAULT 2 NOT NULL,
	"weight_effort" smallint DEFAULT 1 NOT NULL,
	"weight_cost" smallint DEFAULT 1 NOT NULL,
	"weight_risk" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "study_parameters_ranges_ck" CHECK ("study_parameters"."work_days_per_week" between 1 and 7 and "study_parameters"."reserve_pct" between 0 and 1 and "study_parameters"."low_load_threshold" <= "study_parameters"."overload_threshold")
);
--> statement-breakpoint
CREATE TABLE "study_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"label" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suitability_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"correspondence" "correspondence",
	"technical_knowledge" text,
	"training" text,
	"experience" text,
	"technical_competencies" text,
	"behavioral_competencies" text,
	"authorizations" text,
	"autonomy" "level3",
	"compatibility" "compatibility",
	"current_competencies" text,
	"gaps" text,
	"training_possible" "tri_state",
	"reassignment_possible" "reassignment",
	"specialization_needed" boolean,
	"situation" "situation",
	"sensitive_responsibility" boolean,
	"separation_evaluated" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "suitability_activity_uq" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"origin_id" uuid NOT NULL,
	"sheet_name" text NOT NULL,
	"row_ref" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "sync_events_origin_uq" UNIQUE("connection_id","origin_id")
);
--> statement-breakpoint
CREATE TABLE "validation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"field" text,
	"rule_code" text NOT NULL,
	"severity" text NOT NULL,
	"auto_fixable" boolean DEFAULT false NOT NULL,
	"suggested_value" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "actions_area_fk" FOREIGN KEY ("area_id","study_id") REFERENCES "public"."areas"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_position_fk" FOREIGN KEY ("position_id","study_id") REFERENCES "public"."positions"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_secondary_position_fk" FOREIGN KEY ("secondary_position_id","study_id") REFERENCES "public"."positions"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_opportunities" ADD CONSTRAINT "improvement_opportunities_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_opportunities" ADD CONSTRAINT "opportunities_activity_fk" FOREIGN KEY ("related_activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_opportunities" ADD CONSTRAINT "opportunities_area_fk" FOREIGN KEY ("area_id","study_id") REFERENCES "public"."areas"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurability_assessments" ADD CONSTRAINT "measurability_assessments_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurability_assessments" ADD CONSTRAINT "measurability_activity_fk" FOREIGN KEY ("activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_activity_fk" FOREIGN KEY ("activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_area_fk" FOREIGN KEY ("area_id","study_id") REFERENCES "public"."areas"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_site_fk" FOREIGN KEY ("site_id","study_id") REFERENCES "public"."sites"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redesign_proposals" ADD CONSTRAINT "redesign_proposals_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redesign_proposals" ADD CONSTRAINT "redesign_area_fk" FOREIGN KEY ("area_id","study_id") REFERENCES "public"."areas"("id","study_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_activity_fk" FOREIGN KEY ("activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_connections" ADD CONSTRAINT "sheet_connections_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_entries" ADD CONSTRAINT "staffing_entries_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_entries" ADD CONSTRAINT "staffing_position_fk" FOREIGN KEY ("position_id","study_id") REFERENCES "public"."positions"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_parameters" ADD CONSTRAINT "study_parameters_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_snapshots" ADD CONSTRAINT "study_snapshots_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suitability_assessments" ADD CONSTRAINT "suitability_assessments_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suitability_assessments" ADD CONSTRAINT "suitability_activity_fk" FOREIGN KEY ("activity_id","study_id") REFERENCES "public"."activities"("id","study_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_connection_id_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_position_idx" ON "activities" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "audit_study_at_idx" ON "audit_log" USING btree ("study_id","at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staffing_position_idx" ON "staffing_entries" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "issues_study_status_idx" ON "validation_issues" USING btree ("study_id","status");