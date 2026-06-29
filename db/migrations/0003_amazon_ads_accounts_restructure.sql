-- Drop token columns (tokens belong in Secrets Manager, not DB)
ALTER TABLE "amazon_ads_accounts" DROP COLUMN "refresh_token";--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" DROP COLUMN "token_expires_at";--> statement-breakpoint
-- Make columns nullable (populated from /v2/profiles response)
ALTER TABLE "amazon_ads_accounts" ALTER COLUMN "account_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ALTER COLUMN "marketplace" DROP NOT NULL;--> statement-breakpoint
-- Add profile metadata columns
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "country_code" varchar(5);--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "currency_code" varchar(3);--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "timezone" varchar(100);--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "account_type" varchar(20);--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "marketplace_string_id" varchar(50);--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
