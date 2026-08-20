CREATE TYPE "public"."ledger_category" AS ENUM('bulk_operation', 'amazon_recommendation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('engine', 'external');--> statement-breakpoint
CREATE TYPE "public"."task_verify_mismatch_reason" AS ENUM('unchanged', 'different_value', 'entity_deleted');--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'verify_failed' BEFORE 'dismissed';--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"profile" varchar(10),
	"timestamp_detected" timestamp with time zone NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"campaign_name" varchar(500),
	"field" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"source" "ledger_source" NOT NULL,
	"task_id" varchar(24),
	"actor" varchar(255),
	"note" text,
	"category" "ledger_category",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "confirmed_value" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "verify_mismatch_reason" "task_verify_mismatch_reason";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ledger_client_timestamp" ON "ledger_entries" USING btree ("client_id","timestamp_detected");--> statement-breakpoint
CREATE INDEX "idx_ledger_client_entity" ON "ledger_entries" USING btree ("client_id","entity_id");