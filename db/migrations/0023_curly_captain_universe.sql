ALTER TYPE "public"."sync_type" ADD VALUE 'catalog_items';--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amazon_sp_account_id" uuid NOT NULL,
	"asin" varchar(20) NOT NULL,
	"product_name" varchar(500),
	"status" varchar(50),
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_amazon_sp_account_id_amazon_sp_accounts_id_fk" FOREIGN KEY ("amazon_sp_account_id") REFERENCES "public"."amazon_sp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_catalog_items_account_asin" ON "catalog_items" USING btree ("amazon_sp_account_id","asin");--> statement-breakpoint
CREATE INDEX "idx_catalog_items_account" ON "catalog_items" USING btree ("amazon_sp_account_id");