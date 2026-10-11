ALTER TABLE "subjects" ADD COLUMN "credit_hours" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "theory_hours" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "lab_hours" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "prerequisites" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "co_requisites" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "category" text;