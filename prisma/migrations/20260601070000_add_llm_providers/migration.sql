-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'optional',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "temperature" REAL NOT NULL DEFAULT 0,
    "topP" REAL NOT NULL DEFAULT 0.2,
    "maxTokens" INTEGER NOT NULL DEFAULT 4000,
    "timeoutMs" INTEGER NOT NULL DEFAULT 120000,
    "supportsJsonSchema" BOOLEAN NOT NULL DEFAULT true,
    "supportsModelList" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LlmProvider_enabled_isDefault_idx" ON "LlmProvider"("enabled", "isDefault");

-- CreateIndex
CREATE INDEX "LlmProvider_type_idx" ON "LlmProvider"("type");
