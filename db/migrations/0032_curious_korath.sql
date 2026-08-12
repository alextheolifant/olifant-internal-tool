CREATE TYPE "public"."entity_snapshot_type" AS ENUM('campaign', 'ad_group', 'keyword', 'product_target', 'negative', 'product_ad', 'portfolio');--> statement-breakpoint
CREATE TABLE "entity_snapshots_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_ads_account_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"entity_type" "entity_snapshot_type" NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"parent_id" varchar(255),
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_snapshots_daily" ADD CONSTRAINT "entity_snapshots_daily_amazon_ads_account_id_amazon_ads_accounts_id_fk" FOREIGN KEY ("amazon_ads_account_id") REFERENCES "public"."amazon_ads_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entity_snapshot_daily" ON "entity_snapshots_daily" USING btree ("amazon_ads_account_id","snapshot_date","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_entity_snapshot_history" ON "entity_snapshots_daily" USING btree ("amazon_ads_account_id","entity_type","entity_id","snapshot_date");