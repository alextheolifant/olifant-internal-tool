CREATE TYPE "public"."ppc_ops_status" AS ENUM('active', 'frozen');--> statement-breakpoint
ALTER TABLE "ppc_client_configs" ADD COLUMN "ops_status" "ppc_ops_status" DEFAULT 'active' NOT NULL;