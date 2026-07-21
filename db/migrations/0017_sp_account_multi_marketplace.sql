DROP INDEX "uq_sp_account_selling_partner";--> statement-breakpoint
ALTER TABLE "amazon_sp_accounts" ALTER COLUMN "marketplace" SET DATA TYPE varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sp_account_selling_partner_marketplace" ON "amazon_sp_accounts" USING btree ("selling_partner_id","marketplace");