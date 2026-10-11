CREATE TABLE "academic_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"semester_number" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "batches_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"term_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"room_id" integer,
	"teacher_id" integer,
	"subject_id" integer NOT NULL,
	"day_index" integer NOT NULL,
	"period_id" integer NOT NULL,
	"is_repeater" boolean DEFAULT false NOT NULL,
	"source" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_identity_uidx" UNIQUE NULLS NOT DISTINCT("term_id","batch_id","day_index","period_id","subject_id","room_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source_name" text NOT NULL,
	"status" text NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_failed" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "periods_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department" text,
	CONSTRAINT "programs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'classroom' NOT NULL,
	CONSTRAINT "rooms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "teachers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "working_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_working" boolean DEFAULT true NOT NULL,
	CONSTRAINT "working_days_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "batches_program_idx" ON "batches" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "sessions_term_day_period_idx" ON "class_sessions" USING btree ("term_id","day_index","period_id");--> statement-breakpoint
CREATE INDEX "sessions_batch_idx" ON "class_sessions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "sessions_teacher_idx" ON "class_sessions" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "sessions_room_idx" ON "class_sessions" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "sessions_subject_idx" ON "class_sessions" USING btree ("subject_id");