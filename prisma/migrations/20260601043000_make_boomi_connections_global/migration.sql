PRAGMA foreign_keys=OFF;

CREATE TABLE "new_BoomiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "environmentName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "apiUsername" TEXT NOT NULL,
    "apiPassword" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT OR IGNORE INTO "new_BoomiConnection" (
    "id",
    "accountId",
    "environmentName",
    "baseUrl",
    "authMode",
    "apiUsername",
    "apiPassword",
    "mode",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "accountId",
    "environmentName",
    "baseUrl",
    "authMode",
    "apiUsername",
    "apiPassword",
    "mode",
    "createdAt",
    "updatedAt"
FROM "BoomiConnection";

DROP TABLE "BoomiConnection";
ALTER TABLE "new_BoomiConnection" RENAME TO "BoomiConnection";

CREATE INDEX "BoomiConnection_accountId_environmentName_idx" ON "BoomiConnection"("accountId", "environmentName");
CREATE INDEX "BoomiConnection_mode_idx" ON "BoomiConnection"("mode");

PRAGMA foreign_keys=ON;
