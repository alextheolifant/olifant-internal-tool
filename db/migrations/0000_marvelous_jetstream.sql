CREATE TYPE "public"."client_status" AS ENUM('active', 'onboarding', 'paused', 'churned');--> statement-breakpoint
CREATE TYPE "public"."client_tier" AS ENUM('t1', 't2', 't3');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_type" AS ENUM('ads_campaigns', 'ads_metrics', 'sp_orders', 'sp_inventory');--> statement-breakpoint
CREATE TABLE "amazon_ads_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" varchar(255) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"marketplace" varchar(10) NOT NULL,
	"refresh_token" varchar(2048) NOT NULL,
	"access_token" varchar(2048),
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(12, 4) DEFAULT '0' NOT NULL,
	"sales" numeric(12, 4) DEFAULT '0' NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"acos" numeric(8, 4),
	"roas" numeric(8, 4),
	"ctr" numeric(8, 4),
	"cpc" numeric(8, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"campaign_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"state" varchar(50) NOT NULL,
	"budget" numeric(12, 2),
	"budget_type" varchar(50),
	"targeting_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "client_status" DEFAULT 'onboarding' NOT NULL,
	"tier" "client_tier" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"sync_type" "sync_type" NOT NULL,
	"status" "sync_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"records_synced" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD CONSTRAINT "amazon_ads_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_metrics_daily" ADD CONSTRAINT "campaign_metrics_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ads_account_profile" ON "amazon_ads_accounts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_ads_account_client" ON "amazon_ads_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_metrics_campaign_date" ON "campaign_metrics_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "idx_metrics_date" ON "campaign_metrics_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_per_account" ON "campaigns" USING btree ("amazon_ads_account_id","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_account" ON "campaigns" USING btree ("amazon_ads_account_id");--> statement-breakpoint
CREATE INDEX "idx_sync_log_account" ON "sync_logs" USING btree ("amazon_ads_account_id");--> statement-breakpoint
CREATE INDEX "idx_sync_log_status" ON "sync_logs" USING btree ("status");