-- CreateTable
CREATE TABLE "BoomiBuildPipelineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "phase" TEXT,
    "planJson" TEXT NOT NULL,
    "resultsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoomiBuildPipelineRun_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BoomiBuildPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoomiBuildPipelineRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BoomiBuildPipelineRun_packageId_createdAt_idx" ON "BoomiBuildPipelineRun"("packageId", "createdAt");

-- CreateIndex
CREATE INDEX "BoomiBuildPipelineRun_projectId_idx" ON "BoomiBuildPipelineRun"("projectId");

-- CreateIndex
CREATE INDEX "BoomiBuildPipelineRun_status_idx" ON "BoomiBuildPipelineRun"("status");
