ALTER TABLE "clients" ALTER COLUMN "tier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "target_tacos" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;