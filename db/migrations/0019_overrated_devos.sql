CREATE TYPE "public"."ppc_strategy" AS ENUM('launch', 'growth', 'maintain');--> statement-breakpoint
CREATE TABLE "ppc_client_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"monthly_ad_budget" numeric(12, 2),
	"target_acos_default" numeric(5, 2),
	"brand_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"own_asins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sb_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"harvest_destination_campaigns" jsonb,
	"threshold_overrides" jsonb,
	"standing_directives" text,
	"conservative_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_economics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"asin" varchar(20) NOT NULL,
	"product_name" varchar(255),
	"margin" numeric(5, 2),
	"strategy" "ppc_strategy",
	"target_acos" numeric(5, 2),
	"target_tacos" numeric(5, 2),
	"launch_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ppc_client_configs" ADD CONSTRAINT "ppc_client_configs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_economics" ADD CONSTRAINT "product_economics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ppc_client_config_client" ON "ppc_client_configs" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_economics_client_asin" ON "product_economics" USING btree ("client_id","asin");--> statement-breakpoint
CREATE INDEX "idx_product_economics_client" ON "product_economics" USING btree ("client_id");