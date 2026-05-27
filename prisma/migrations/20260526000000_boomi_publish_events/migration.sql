CREATE TABLE "BoomiPublishEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "connectionId" TEXT,
    "componentId" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "version" INTEGER,
    "action" TEXT NOT NULL,
    "requestXml" TEXT NOT NULL,
    "responseXml" TEXT,
    "status" TEXT NOT NULL,
    "errorDetail" TEXT,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoomiPublishEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BoomiPublishEvent_projectId_publishedAt_idx" ON "BoomiPublishEvent"("projectId", "publishedAt");
CREATE INDEX "BoomiPublishEvent_draftId_idx" ON "BoomiPublishEvent"("draftId");
