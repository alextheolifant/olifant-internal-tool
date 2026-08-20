CREATE TYPE "public"."task_confidence" AS ENUM('high', 'medium', 'provisional');--> statement-breakpoint
CREATE TYPE "public"."task_dismiss_reason" AS ENUM('not_actionable', 'already_handled', 'incorrect_data', 'client_preference', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'approved', 'blocked', 'executed', 'verified', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('negation', 'bid_change', 'harvest_launch', 'budget', 'placement', 'pause', 'structural', 'exception', 'investigate', 'sqp_opportunity', 'rank_defense', 'cro_flag', 'inventory_guard', 'pacing');--> statement-breakpoint
CREATE TABLE "task_id_counters" (
	"date_key" date PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar(24) PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"profile" varchar(10),
	"rule_id" varchar(20) NOT NULL,
	"type" "task_type" NOT NULL,
	"title" text NOT NULL,
	"action" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"instructions" jsonb NOT NULL,
	"impact_monthly_usd" numeric(12, 2),
	"impact_basis" text,
	"priority_score" integer NOT NULL,
	"confidence" "task_confidence" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"blocked_by" varchar(24),
	"requires_review" boolean DEFAULT false NOT NULL,
	"standing_directives_ack" boolean DEFAULT false NOT NULL,
	"assignee" varchar(255),
	"rollback" text NOT NULL,
	"dismiss_reason" "task_dismiss_reason",
	"dismiss_note" text,
	"action_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ppc_client_configs" ADD COLUMN "priority_multiplier" numeric(4, 2) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_by_tasks_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tasks_client_status" ON "tasks" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_dedup" ON "tasks" USING btree ("client_id","rule_id","action_fingerprint");