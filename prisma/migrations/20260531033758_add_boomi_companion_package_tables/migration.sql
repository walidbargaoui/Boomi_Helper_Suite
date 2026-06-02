-- CreateTable
CREATE TABLE "BoomiBuildPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "specJson" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "readinessJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoomiBuildPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoomiCompanionRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'handoff_created',
    "resultJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoomiCompanionRunEvent_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BoomiBuildPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BoomiBuildPackage_projectId_createdAt_idx" ON "BoomiBuildPackage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BoomiBuildPackage_status_idx" ON "BoomiBuildPackage"("status");

-- CreateIndex
CREATE INDEX "BoomiCompanionRunEvent_packageId_createdAt_idx" ON "BoomiCompanionRunEvent"("packageId", "createdAt");

-- CreateIndex
CREATE INDEX "BoomiCompanionRunEvent_status_idx" ON "BoomiCompanionRunEvent"("status");
