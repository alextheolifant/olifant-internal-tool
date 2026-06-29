CREATE TABLE "login_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"user_id" uuid,
	"ip" varchar(45) NOT NULL,
	"user_agent" varchar(500),
	"success" boolean NOT NULL,
	"failure_reason" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_audit_logs" ADD CONSTRAINT "login_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_login_audit_email" ON "login_audit_logs" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_login_audit_created_at" ON "login_audit_logs" USING btree ("created_at");