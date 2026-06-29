CREATE TABLE "amazon_sp_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "selling_partner_id" varchar(255),
  "marketplace" varchar(10),
  "region" varchar(10),
  "refresh_token" varchar(2048),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "amazon_sp_accounts_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "idx_sp_account_client" ON "amazon_sp_accounts" ("client_id");
