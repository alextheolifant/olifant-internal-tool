ALTER TABLE "amazon_ads_accounts" ADD COLUMN "region" varchar(3);
UPDATE "amazon_ads_accounts" SET "region" = 'na' WHERE "region" IS NULL;