ALTER TABLE "task_candidates" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "entity_type" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "entity_id" varchar(255) NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tasks_entity" ON "tasks" USING btree ("client_id","rule_id","entity_type","entity_id");