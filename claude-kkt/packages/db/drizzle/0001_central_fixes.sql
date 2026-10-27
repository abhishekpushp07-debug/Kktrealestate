ALTER TABLE "service_requests" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_payment_plan_idx" ON "bookings" USING btree ("payment_plan_id");--> statement-breakpoint
CREATE INDEX "payment_plan_assignments_plan_idx" ON "payment_plan_assignments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "audit_logs_company_created_idx" ON "audit_logs" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flat_types_rooms_gin_idx" ON "flat_types" USING gin ("rooms");--> statement-breakpoint
CREATE INDEX "flat_types_areas_gin_idx" ON "flat_types" USING gin ("areas");--> statement-breakpoint
CREATE INDEX "floor_plan_templates_positions_gin_idx" ON "floor_plan_templates" USING gin ("positions");--> statement-breakpoint
CREATE INDEX "blocks_floor_plans_gin_idx" ON "blocks" USING gin ("floor_plans");--> statement-breakpoint
CREATE INDEX "site_visits_lead_status_idx" ON "site_visits" USING btree ("lead_id","status");