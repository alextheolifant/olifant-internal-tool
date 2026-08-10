CREATE TABLE "search_term_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_term" text NOT NULL,
	"keyword_id" varchar(64),
	"campaign_id" varchar(64) NOT NULL,
	"ad_group_id" varchar(64) NOT NULL,
	"match_type" varchar(32),
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 4) DEFAULT '0' NOT NULL,
	"sales_7d" numeric(12, 4) DEFAULT '0' NOT NULL,
	"sales_14d" numeric(12, 4) DEFAULT '0' NOT NULL,
	"orders_7d" integer DEFAULT 0 NOT NULL,
	"orders_14d" integer DEFAULT 0 NOT NULL,
	"units_7d" integer DEFAULT 0 NOT NULL,
	"units_14d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"expression" text NOT NULL,
	"match_type" varchar(32),
	"campaign_id" varchar(64) NOT NULL,
	"ad_group_id" varchar(64) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 4) DEFAULT '0' NOT NULL,
	"sales_7d" numeric(12, 4) DEFAULT '0' NOT NULL,
	"sales_14d" numeric(12, 4) DEFAULT '0' NOT NULL,
	"orders_7d" integer DEFAULT 0 NOT NULL,
	"orders_14d" integer DEFAULT 0 NOT NULL,
	"units_7d" integer DEFAULT 0 NOT NULL,
	"units_14d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads_report_requests" ADD COLUMN "report_type" varchar(20) DEFAULT 'campaigns' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_term_metrics_daily" ADD CONSTRAINT "search_term_metrics_daily_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_metrics_daily" ADD CONSTRAINT "target_metrics_daily_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Plain btree unique on a nullable column would let multiple rows with
-- keyword_id IS NULL (auto/product-targeting search terms) coexist for the
-- same term/campaign/ad-group/date instead of upserting into one row —
-- Postgres never treats two NULLs as equal for uniqueness. Coalesce to ''
-- so those rows dedupe too; the writer's ON CONFLICT target must match this
-- exact expression.
CREATE UNIQUE INDEX "uq_search_term_metrics" ON "search_term_metrics_daily" USING btree ("amazon_ads_account_id","date","search_term",(COALESCE("keyword_id", '')),"campaign_id","ad_group_id");--> statement-breakpoint
CREATE INDEX "idx_search_term_metrics_date" ON "search_term_metrics_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_search_term_metrics_account" ON "search_term_metrics_daily" USING btree ("amazon_ads_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_target_metrics" ON "target_metrics_daily" USING btree ("amazon_ads_account_id","date","target_id");--> statement-breakpoint
CREATE INDEX "idx_target_metrics_date" ON "target_metrics_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_target_metrics_account" ON "target_metrics_daily" USING btree ("amazon_ads_account_id");--> statement-breakpoint
-- Re-scope the active-request dedup index to include report_type, so an
-- in-flight campaigns report never blocks submitting a search-term/targeting
-- report for the same account + date range.
DROP INDEX "uq_report_req_active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_req_active" ON "ads_report_requests" ("amazon_ads_account_id", "report_type", "start_date", "end_date") WHERE status IN ('PENDING', 'PROCESSING');