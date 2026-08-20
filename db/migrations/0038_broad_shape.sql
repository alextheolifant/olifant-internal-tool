CREATE TYPE "public"."monitor_state" AS ENUM('watching', 'concluded');--> statement-breakpoint
CREATE TABLE "task_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar(24) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"campaign_id" varchar(255) NOT NULL,
	"execution_date" date NOT NULL,
	"state" "monitor_state" DEFAULT 'watching' NOT NULL,
	"checkpoint_14d" jsonb,
	"verdict_30d" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_monitors" ADD CONSTRAINT "task_monitors_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_task_monitor_task" ON "task_monitors" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_task_monitor_state" ON "task_monitors" USING btree ("state","execution_date");