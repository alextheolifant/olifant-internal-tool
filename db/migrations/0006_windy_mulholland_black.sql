ALTER TYPE "public"."sync_type" ADD VALUE 'ads_profiles';--> statement-breakpoint
ALTER TABLE "sync_logs" ALTER COLUMN "amazon_ads_account_id" DROP NOT NULL;