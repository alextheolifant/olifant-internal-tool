ALTER TYPE "public"."sync_type" ADD VALUE 'ads_metrics_retry' BEFORE 'sp_orders';--> statement-breakpoint
ALTER TABLE "ads_report_requests" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;