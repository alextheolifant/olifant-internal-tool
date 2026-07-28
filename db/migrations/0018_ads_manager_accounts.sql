CREATE TABLE "ads_manager_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connected_by_user_id" uuid,
	"refresh_token" varchar(2048) NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD COLUMN "ads_manager_account_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ads_manager_accounts" ADD CONSTRAINT "ads_manager_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_manager_accounts" ADD CONSTRAINT "ads_manager_accounts_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ads_manager_account_org" ON "ads_manager_accounts" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "amazon_ads_accounts" ADD CONSTRAINT "amazon_ads_accounts_ads_manager_account_id_ads_manager_accounts_id_fk" FOREIGN KEY ("ads_manager_account_id") REFERENCES "public"."ads_manager_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Seed the single Olifant org row. No unique constraint on organizations.name
-- (deliberately, to leave room for a real multi-tenant model later), so guard
-- with WHERE NOT EXISTS instead of ON CONFLICT.
INSERT INTO organizations (name)
SELECT 'Olifant'
WHERE NOT EXISTS (SELECT 1 FROM organizations LIMIT 1);
--> statement-breakpoint

-- Backfill every existing user to that one org before organization_id can be
-- made NOT NULL below.
UPDATE users SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;
--> statement-breakpoint

ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL;