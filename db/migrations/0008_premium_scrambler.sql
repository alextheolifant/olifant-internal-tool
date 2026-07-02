ALTER TABLE "campaigns" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "portfolio_id" varchar(255);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bidding_strategy" varchar(100);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "raw_data" jsonb;