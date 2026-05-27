-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "destinationSystem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "owner" TEXT NOT NULL,
    "schedule" TEXT,
    "lastExportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "connectorType" TEXT NOT NULL,
    "profileType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "connectionInfo" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Endpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "rootPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "parentPath" TEXT,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "dataType" TEXT NOT NULL,
    "length" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "keyField" BOOLEAN NOT NULL DEFAULT false,
    "format" TEXT,
    "sample" TEXT,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "ProfileField_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MappingSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceProfileId" TEXT NOT NULL,
    "destinationProfileId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MappingSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MappingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mappingSetId" TEXT NOT NULL,
    "sourceFieldId" TEXT,
    "destinationFieldId" TEXT NOT NULL,
    "mappingType" TEXT NOT NULL,
    "expression" TEXT,
    "defaultValue" TEXT,
    "comment" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MappingRule_mappingSetId_fkey" FOREIGN KEY ("mappingSetId") REFERENCES "MappingSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MappingRule_sourceFieldId_fkey" FOREIGN KEY ("sourceFieldId") REFERENCES "ProfileField" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MappingRule_destinationFieldId_fkey" FOREIGN KEY ("destinationFieldId") REFERENCES "ProfileField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransformNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mappingSetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "positionX" REAL NOT NULL,
    "positionY" REAL NOT NULL,
    CONSTRAINT "TransformNode_mappingSetId_fkey" FOREIGN KEY ("mappingSetId") REFERENCES "MappingSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nodesJson" TEXT NOT NULL,
    "edgesJson" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessFlow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FmdSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FmdSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoomiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "environmentName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "apiUsername" TEXT NOT NULL,
    "apiPassword" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoomiConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoomiComponentDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "templateXml" TEXT,
    "proposedXml" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoomiComponentDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_processId_key" ON "Project"("processId");
