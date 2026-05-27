-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "destinationSystem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "folder" TEXT NOT NULL DEFAULT 'Uncategorized',
    "owner" TEXT NOT NULL,
    "schedule" TEXT,
    "lastExportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("createdAt", "description", "destinationSystem", "id", "lastExportedAt", "name", "owner", "processId", "schedule", "sourceSystem", "status", "updatedAt", "version") SELECT "createdAt", "description", "destinationSystem", "id", "lastExportedAt", "name", "owner", "processId", "schedule", "sourceSystem", "status", "updatedAt", "version" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_processId_key" ON "Project"("processId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
