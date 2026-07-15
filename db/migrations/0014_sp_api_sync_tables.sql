CREATE TABLE "sp_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_sp_account_id" uuid NOT NULL,
	"asin" varchar(20) NOT NULL,
	"seller_sku" varchar(255),
	"fulfillable_quantity" integer DEFAULT 0 NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sp_report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_sp_account_id" uuid NOT NULL,
	"region" varchar(3) NOT NULL,
	"report_id" varchar(255) NOT NULL,
	"report_document_id" varchar(255),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'IN_QUEUE' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "sp_sales_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_sp_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_sales" numeric(12, 4) DEFAULT '0' NOT NULL,
	"units_ordered" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_logs" ADD COLUMN "amazon_sp_account_id" uuid;--> statement-breakpoint
ALTER TABLE "sp_inventory" ADD CONSTRAINT "sp_inventory_amazon_sp_account_id_amazon_sp_accounts_id_fk" FOREIGN KEY ("amazon_sp_account_id") REFERENCES "public"."amazon_sp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sp_report_requests" ADD CONSTRAINT "sp_report_requests_amazon_sp_account_id_amazon_sp_accounts_id_fk" FOREIGN KEY ("amazon_sp_account_id") REFERENCES "public"."amazon_sp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sp_sales_daily" ADD CONSTRAINT "sp_sales_daily_amazon_sp_account_id_amazon_sp_accounts_id_fk" FOREIGN KEY ("amazon_sp_account_id") REFERENCES "public"."amazon_sp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sp_inventory_account_asin" ON "sp_inventory" USING btree ("amazon_sp_account_id","asin");--> statement-breakpoint
CREATE INDEX "idx_sp_inventory_account" ON "sp_inventory" USING btree ("amazon_sp_account_id");--> statement-breakpoint
CREATE INDEX "idx_sp_report_req_status" ON "sp_report_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sp_report_req_account" ON "sp_report_requests" USING btree ("amazon_sp_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sp_sales_account_date" ON "sp_sales_daily" USING btree ("amazon_sp_account_id","date");--> statement-breakpoint
CREATE INDEX "idx_sp_sales_date" ON "sp_sales_daily" USING btree ("date");--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_amazon_sp_account_id_amazon_sp_accounts_id_fk" FOREIGN KEY ("amazon_sp_account_id") REFERENCES "public"."amazon_sp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sync_log_sp_account" ON "sync_logs" USING btree ("amazon_sp_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sp_report_req_active" ON "sp_report_requests" ("amazon_sp_account_id", "start_date", "end_date") WHERE status IN ('IN_QUEUE', 'IN_PROGRESS');