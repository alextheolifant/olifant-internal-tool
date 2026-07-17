CREATE TYPE "public"."anomaly_metric" AS ENUM('acos', 'spend', 'ctr', 'clicks', 'tacos', 'revenue');--> statement-breakpoint
CREATE TYPE "public"."anomaly_severity" AS ENUM('watch', 'act_now');--> statement-breakpoint
ALTER TYPE "public"."sync_type" ADD VALUE 'anomaly_detection';--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"metric" "anomaly_metric" NOT NULL,
	"baseline_value" numeric(14, 4) NOT NULL,
	"actual_value" numeric(14, 4) NOT NULL,
	"percent_change" numeric(10, 2),
	"severity" "anomaly_severity" NOT NULL,
	"explanation" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_anomaly_open_lookup" ON "anomalies" USING btree ("client_id","metric","resolved");