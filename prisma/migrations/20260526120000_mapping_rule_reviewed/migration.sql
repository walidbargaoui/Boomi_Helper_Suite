-- AddReviewedFlag: explicit per-rule review state for the pre-publish quality workflow.
ALTER TABLE "MappingRule" ADD COLUMN "reviewed" BOOLEAN NOT NULL DEFAULT false;
