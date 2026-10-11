CREATE TABLE "batch_subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_subjects_uidx" UNIQUE("batch_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "batch_subjects" ADD CONSTRAINT "batch_subjects_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_subjects" ADD CONSTRAINT "batch_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_subjects_batch_idx" ON "batch_subjects" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_subjects_subject_idx" ON "batch_subjects" USING btree ("subject_id");