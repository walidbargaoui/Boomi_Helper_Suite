import os from "os";
import fs from "fs";
import path from "path";
import type {
  BoomiBuildSpec,
  BuildProfileRef,
  BuildEndpointFieldRef,
  BuildEndpoint,
  BuildMappingSet,
  BuildProcessFlow,
  Profile,
  ProfileField,
} from "@/lib/domain";
import { buildProfileXml } from "@/lib/boomi-xml";

const COMPANION_FOLDER_NAME = "active-development";

function profileTypeToComponentType(profileType: string): string {
  const map: Record<string, string> = {
    "Flat File": "profile.flatfile",
    "CSV": "profile.flatfile",
    "TSV": "profile.flatfile",
    "JSON": "profile.json",
    "XML": "profile.xml",
    "Database": "profile.db",
    "API": "profile.json",
  };
  return map[profileType] ?? "profile.json";
}

function profileComponentDir(profileType: string): string {
  return profileTypeToComponentType(profileType).replace("profile.", "profile.");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function specProfileToProfile(ref: BuildProfileRef): Profile {
  return {
    id: ref.localProfileId,
    name: ref.name,
    role: ref.role,
    type: (ref.type as Profile["type"]) ?? "Flat File",
    format: ref.format,
    rootPath: ref.rootPath,
    fields: ref.fields.map(
      (f: BuildEndpointFieldRef): ProfileField => ({
        id: f.localFieldId,
        parentPath: f.parentPath,
        name: f.name,
        label: f.label,
        description: f.description,
        dataType: f.dataType,
        length: sanitizeLength(f.length),
        required: f.required,
        keyField: f.keyField,
        format: f.format,
        sample: f.sample,
        ordinal: f.ordinal,
      }),
    ),
  };
}

function sanitizeLength(length?: string): string | undefined {
  if (!length) return undefined;
  const cleaned = length.replace(/[,_]/g, ".");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  return String(Math.floor(num));
}

function generateConnectionXml(endpoint: BuildEndpoint): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GenericConnector type="connector-settings" xmlns="http://api.platform.boomi.com/">
  <name>${escapeXml(endpoint.name)}</name>
  <connectorType>${escapeXml(endpoint.connectorType)}</connectorType>
  <field>
    <fieldID>connection</fieldID>
    <value>
      <encryptedValue>PLACEHOLDER</encryptedValue>
    </value>
  </field>
</GenericConnector>`;
}

function generateOperationXml(endpoint: BuildEndpoint, profileName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GenericConnector type="connector-action" xmlns="http://api.platform.boomi.com/">
  <name>${escapeXml(`${endpoint.name} Operation`)}</name>
  <connectorType>${escapeXml(endpoint.connectorType)}</connectorType>
  <profile componentId="" name="${escapeXml(profileName)}"/>
  <field>
    <fieldID>action</fieldID>
    <value>SEND</value>
  </field>
</GenericConnector>`;
}

function generateMapXml(
  mappingSet: BuildMappingSet,
  sourceProfile: BuildProfileRef,
  destProfile: BuildProfileRef,
): string {
  const rulesXml = mappingSet.rules
    .map((r) => {
      const srcField = sourceProfile.fields.find((f) => f.localFieldId === r.sourceFieldId);
      const dstField = destProfile.fields.find((f) => f.localFieldId === r.destinationFieldId);
      return `    <map input="${escapeXml(srcField?.name ?? r.sourceFieldId ?? "")}" output="${escapeXml(dstField?.name ?? r.destinationFieldId)}" type="${escapeXml(r.mappingType)}"/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TransformMap type="transform.map" xmlns="http://api.platform.boomi.com/">
  <name>${escapeXml(mappingSet.name)}</name>
  <sourceProfile>${escapeXml(mappingSet.sourceProfileRef)}</sourceProfile>
  <destinationProfile>${escapeXml(mappingSet.destinationProfileRef)}</destinationProfile>
  <mappings>
${rulesXml}
  </mappings>
</TransformMap>`;
}

function generateProcessXml(flow: BuildProcessFlow): string {
  const nodesXml = flow.nodes
    .map(
      (n) =>
        `  <shape type="${escapeXml(n.type)}" label="${escapeXml(n.label)}" x="${n.position.x}" y="${n.position.y}"/>`,
    )
    .join("\n");

  const edgesXml = flow.edges
    .map(
      (e) =>
        `  <connector source="${escapeXml(e.source)}" target="${escapeXml(e.target)}"/>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Process type="process" xmlns="http://api.platform.boomi.com/">
  <name>${escapeXml(flow.name)}</name>
  <shapes>
${nodesXml}
  </shapes>
  <connectors>
${edgesXml}
  </connectors>
</Process>`;
}

export type WorkspaceEntry = {
  relativePath: string;
  componentType?: string;
  componentName?: string;
};

export type Workspace = {
  dir: string;
  entries: WorkspaceEntry[];
};

export function buildWorkspace(
  packageId: string,
  spec: BoomiBuildSpec,
  connection: {
    baseUrl: string;
    apiUsername: string;
    accountId: string;
    environmentName: string;
    decryptedApiUsername?: string;
    decryptedApiToken?: string;
  },
): Workspace {
  const workspaceDir = path.join(os.tmpdir(), `boomi-companion-workspace-${packageId}`);
  const activeDevDir = path.join(workspaceDir, COMPANION_FOLDER_NAME);
  const entries: WorkspaceEntry[] = [];

  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
  fs.mkdirSync(workspaceDir, { recursive: true });

  const rawUser = connection.decryptedApiUsername ?? connection.apiUsername;
  const companionUser = rawUser.replace(/^BOOMI_TOKEN\./i, "");

  const envLines = [
    `BOOMI_API_URL=${connection.baseUrl}`,
    `BOOMI_USERNAME=${companionUser}`,
    `BOOMI_API_TOKEN=${connection.decryptedApiToken ?? ""}`,
    `BOOMI_ACCOUNT_ID=${connection.accountId}`,
    `BOOMI_ENVIRONMENT_ID=${connection.environmentName}`,
    `BOOMI_TEST_ATOM_ID=`,
    `BOOMI_TARGET_FOLDER=${spec.project.folder ?? ""}`,
    `BOOMI_VERIFY_SSL=true`,
    `SKILL_PATH=${workspaceDir}`,
  ];
  fs.writeFileSync(path.join(workspaceDir, ".env"), envLines.join("\n"), "utf8");
  entries.push({ relativePath: ".env" });

  const subdirs = new Set<string>();
  for (const profile of spec.profiles) {
    const componentDir = profileComponentDir(profile.type);
    subdirs.add(componentDir);
  }
  subdirs.add("connector-settings");
  subdirs.add("connector-action");
  subdirs.add("transform.map");
  subdirs.add("process");

  for (const subdir of subdirs) {
    const dir = path.join(activeDevDir, subdir);
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const profileRef of spec.profiles) {
    const profile = specProfileToProfile(profileRef);
    const { xml } = buildProfileXml(profile);
    const componentDir = profileComponentDir(profileRef.type);
    const fileName = `${sanitizeFileName(profileRef.name)}.xml`;
    const filePath = path.join(activeDevDir, componentDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    entries.push({
      relativePath: path.join(COMPANION_FOLDER_NAME, componentDir, fileName),
      componentType: profileTypeToComponentType(profileRef.type),
      componentName: profileRef.name,
    });
  }

  for (const endpointRef of spec.endpoints) {
    const connXml = generateConnectionXml(endpointRef);
    const connFileName = `${sanitizeFileName(endpointRef.name)}_connection.xml`;
    const connPath = path.join(activeDevDir, "connector-settings", connFileName);
    fs.writeFileSync(connPath, connXml, "utf8");
    entries.push({
      relativePath: path.join(COMPANION_FOLDER_NAME, "connector-settings", connFileName),
      componentType: "connector-settings",
      componentName: endpointRef.name,
    });

    const matchingProfile = spec.profiles.find(
      (p) => endpointRef.profileType && p.type === endpointRef.profileType,
    );
    const profileName = matchingProfile?.name ?? "Profile";
    const opXml = generateOperationXml(endpointRef, profileName);
    const opFileName = `${sanitizeFileName(endpointRef.name)}_operation.xml`;
    const opPath = path.join(activeDevDir, "connector-action", opFileName);
    fs.writeFileSync(opPath, opXml, "utf8");
    entries.push({
      relativePath: path.join(COMPANION_FOLDER_NAME, "connector-action", opFileName),
      componentType: "connector-action",
      componentName: `${endpointRef.name} Operation`,
    });
  }

  for (const mappingSetRef of spec.mappingSets) {
    const sourceProfileRef = spec.profiles.find(
      (p) => p.name === mappingSetRef.sourceProfileRef,
    );
    const destProfileRef = spec.profiles.find(
      (p) => p.name === mappingSetRef.destinationProfileRef,
    );
    if (sourceProfileRef && destProfileRef) {
      const mapXml = generateMapXml(mappingSetRef, sourceProfileRef, destProfileRef);
      const fileName = `${sanitizeFileName(mappingSetRef.name)}.xml`;
      const filePath = path.join(activeDevDir, "transform.map", fileName);
      fs.writeFileSync(filePath, mapXml, "utf8");
      entries.push({
        relativePath: path.join(COMPANION_FOLDER_NAME, "transform.map", fileName),
        componentType: "transform.map",
        componentName: mappingSetRef.name,
      });
    }
  }

  for (const flowRef of spec.processFlows) {
    const processXml = generateProcessXml(flowRef);
    const fileName = `${sanitizeFileName(flowRef.name)}.xml`;
    const filePath = path.join(activeDevDir, "process", fileName);
    fs.writeFileSync(filePath, processXml, "utf8");
    entries.push({
      relativePath: path.join(COMPANION_FOLDER_NAME, "process", fileName),
      componentType: "process",
      componentName: flowRef.name,
    });
  }

  return { dir: workspaceDir, entries };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

export function cleanWorkspace(workspaceDir: string): void {
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}
