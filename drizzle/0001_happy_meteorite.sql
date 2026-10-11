CREATE TABLE "import_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"page" integer,
	"row_ref" text,
	"level" text DEFAULT 'error' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_errors_job_idx" ON "import_errors" USING btree ("job_id");