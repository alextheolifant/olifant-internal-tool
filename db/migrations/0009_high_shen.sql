CREATE TABLE "ads_report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"sync_log_id" uuid,
	"region" varchar(3) NOT NULL,
	"report_id" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "ads_report_requests" ADD CONSTRAINT "ads_report_requests_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_report_requests" ADD CONSTRAINT "ads_report_requests_sync_log_id_sync_logs_id_fk" FOREIGN KEY ("sync_log_id") REFERENCES "public"."sync_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_report_req_status" ON "ads_report_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_report_req_account" ON "ads_report_requests" USING btree ("amazon_ads_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_req_active" ON "ads_report_requests" ("amazon_ads_account_id", "start_date", "end_date") WHERE status IN ('PENDING', 'PROCESSING');