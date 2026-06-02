import type {
  BoomiBuildSpec,
  BuildProjectSummary,
  BuildTargetIntent,
  BuildEndpoint,
  BuildProfileRef,
  BuildEndpointFieldRef,
  BuildMappingSet,
  BuildMappingRule,
  BuildTransformNode,
  BuildProcessFlow,
  BuildProcessFlowNode,
  BuildProcessFlowEdge,
  BuildFmdSectionSummary,
  BuildImportedBoomiContext,
  BuildImportedBoomiComponent,
  BuildReadinessReport,
  ReadinessCheck,
  Project,
} from "@/lib/domain";

function buildProjectSummary(project: Project): BuildProjectSummary {
  return {
    processId: project.processId,
    name: project.name,
    description: project.description,
    sourceSystem: project.sourceSystem,
    destinationSystem: project.destinationSystem,
    status: project.status,
    folder: project.folder,
    owner: project.owner,
    schedule: project.schedule,
    localProjectId: project.id,
  };
}

function buildTargetIntent(project: Project): BuildTargetIntent {
  const firstFlow = project.processFlows?.[0];
  return {
    goal: `Integrate ${project.sourceSystem || "source"} to ${project.destinationSystem || "destination"}: ${project.name}`,
    integrationPattern: firstFlow?.name ?? project.description.slice(0, 80),
    notes: project.description || undefined,
  };
}

function buildEndpoints(project: Project): BuildEndpoint[] {
  return project.endpoints.map((ep) => ({
    localEndpointId: ep.id,
    name: ep.name,
    role: ep.role,
    connectorType: ep.connectorType,
    profileType: ep.profileType,
    format: ep.format,
    purpose: ep.purpose,
    connectionInfo: ep.connectionInfo,
  }));
}

function buildProfiles(project: Project): BuildProfileRef[] {
  return project.profiles.map((profile) => ({
    localProfileId: profile.id,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    format: profile.format,
    rootPath: profile.rootPath,
    fields: profile.fields.map((f): BuildEndpointFieldRef => ({
      localFieldId: f.id,
      parentPath: f.parentPath,
      name: f.name,
      label: f.label,
      description: f.description,
      dataType: f.dataType,
      length: f.length,
      required: f.required,
      keyField: f.keyField,
      format: f.format,
      sample: f.sample,
      ordinal: f.ordinal,
    })),
  }));
}

function buildMappingSets(project: Project): BuildMappingSet[] {
  if (!project.mappingSets?.length) return [];

  const profileById = new Map(project.profiles.map((p) => [p.id, p]));
  const fieldById = new Map(
    project.profiles.flatMap((p) => p.fields.map((f) => [f.id, f]))
  );

  return project.mappingSets.map((ms) => ({
    localMappingSetId: ms.id,
    name: ms.name,
    sourceProfileRef: profileById.get(ms.sourceProfileId)?.name ?? ms.sourceProfileId,
    destinationProfileRef: profileById.get(ms.destinationProfileId)?.name ?? ms.destinationProfileId,
    direction: ms.direction,
    status: ms.status,
    rules: ms.rules.map((r): BuildMappingRule => {
      const srcField = r.sourceFieldId ? fieldById.get(r.sourceFieldId) : undefined;
      const dstField = fieldById.get(r.destinationFieldId);
      return {
        localRuleId: r.id,
        sourceFieldId: r.sourceFieldId,
        destinationFieldId: r.destinationFieldId,
        sourceFieldName: srcField?.name,
        destinationFieldName: dstField?.name ?? r.destinationFieldId,
        mappingType: r.mappingType,
        expression: r.expression,
        defaultValue: r.defaultValue,
        comment: r.comment,
        qualityStatus: r.qualityStatus,
        reviewed: r.reviewed ?? false,
      };
    }),
    transformNodes: ms.transformNodes.map((tn): BuildTransformNode => ({
      localNodeId: tn.id,
      label: tn.label,
      nodeType: tn.nodeType,
      config: tn.config,
      position: tn.position,
    })),
  }));
}

function buildProcessFlows(project: Project): BuildProcessFlow[] {
  if (!project.processFlows?.length) return [];

  return project.processFlows.map((flow) => ({
    localFlowId: flow.id,
    name: flow.name,
    nodes: flow.nodes.map((n): BuildProcessFlowNode => ({
      localNodeId: n.id,
      type: n.type,
      label: n.label,
      description: n.description,
      position: n.position,
    })),
    edges: flow.edges.map((e): BuildProcessFlowEdge => ({
      localEdgeId: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
    })),
    notes: flow.notes,
  }));
}

function buildFmdSections(project: Project): BuildFmdSectionSummary[] {
  if (!project.fmdSections?.length) return [];

  return project.fmdSections.map((section) => {
    const evidence = extractBuildEvidence(section.sectionType, section.content);
    return {
      localSectionId: section.id,
      sectionType: section.sectionType,
      title: section.title,
      contentSummary: summarizeFmdContent(section.content),
      buildEvidence: evidence,
    };
  });
}

function extractBuildEvidence(
  sectionType: string,
  content: Record<string, unknown>
): string[] {
  const evidence: string[] = [];
  switch (sectionType) {
    case "overview":
      if (content.summary) evidence.push(`Integration summary: ${content.summary}`);
      if (content.schedule) evidence.push(`Schedule pattern: ${content.schedule}`);
      break;
    case "environment":
      if (Array.isArray(content.boomiEnvironments)) {
        evidence.push(`Target environments: ${(content.boomiEnvironments as string[]).join(", ")}`);
      }
      if (content.network) evidence.push(`Network notes: ${content.network}`);
      break;
    case "jobHandling":
      if (content.schedule) evidence.push(`Scheduler: ${content.schedule}`);
      if (content.retryPolicy) evidence.push(`Retry policy: ${content.retryPolicy}`);
      if (content.notifications) evidence.push(`Notifications: ${content.notifications}`);
      break;
    case "documentLog":
      if (Array.isArray(content.rows)) {
        evidence.push(`Document has ${(content.rows as unknown[]).length} revision(s)`);
      }
      break;
    default:
      break;
  }
  return evidence;
}

function summarizeFmdContent(content: Record<string, unknown>): string {
  const entries = Object.entries(content).filter(
    ([, v]) => typeof v === "string"
  ) as [string, string][];

  if (entries.length === 0) {
    if (Array.isArray(content.rows)) {
      return `Contains ${(content.rows as unknown[]).length} row(s) of structured data`;
    }
    return "Non-text content present";
  }

  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v.length > 80 ? v.slice(0, 80) + "..." : v}`)
    .join("; ");
}

function buildImportedBoomiContext(project: Project): BuildImportedBoomiContext {
  if (!project.boomiDrafts?.length) {
    return { components: [], dependencyNotes: [] };
  }

  const components: BuildImportedBoomiComponent[] = project.boomiDrafts.map((draft) => ({
    localDraftId: draft.id,
    name: draft.componentName,
    componentType: draft.componentType,
    boomiComponentId: draft.componentId || undefined,
    version: undefined,
    hasTemplateXml: !!draft.templateXml,
  }));

  const dependencyNotes: string[] = [];
  const hasTemplate = project.boomiDrafts.some((d) => d.templateXml);
  const missingTemplates = project.boomiDrafts.filter(
    (d) => !d.templateXml && d.componentType === "transform.map"
  );

  if (missingTemplates.length > 0) {
    dependencyNotes.push(
      `${missingTemplates.length} component(s) missing Boomi template — Companion agent should create from scratch by default`
    );
  }

  if (!hasTemplate && project.boomiDrafts.length > 0) {
    dependencyNotes.push(
      "No Boomi templates imported — Companion agent must create all components fresh"
    );
  }

  const hasScaffoldDraft = project.boomiDrafts.some(
    (d) => d.componentType === "process" && d.validationStatus === "Needs template"
  );
  if (hasScaffoldDraft) {
    dependencyNotes.push(
      "Process component has no template — Companion agent should create from scratch by default using a process skeleton"
    );
  }

  return { components, dependencyNotes };
}

function generateReadinessReport(project: Project): BuildReadinessReport {
  const checks: ReadinessCheck[] = [];

  const sourceProfiles = project.profiles.filter((p) => p.role === "source");
  const destProfiles = project.profiles.filter((p) => p.role === "destination");

  if (sourceProfiles.length === 0) {
    checks.push({
      category: "Profiles",
      status: "error",
      message: "No source profile defined",
    });
  } else {
    checks.push({
      category: "Profiles",
      status: "ok",
      message: `${sourceProfiles.length} source profile(s) defined`,
      details: sourceProfiles.map((p) => `${p.name} (${p.type}, ${p.fields.length} fields)`),
    });
  }

  if (destProfiles.length === 0) {
    checks.push({
      category: "Profiles",
      status: "error",
      message: "No destination profile defined",
    });
  } else {
    const destFields = destProfiles.flatMap((p) => p.fields);
    const unmappedRequired = destFields.filter((f) => {
      if (!f.required) return false;
      const allRules = project.mappingSets?.flatMap((ms) => ms.rules) ?? [];
      return !allRules.some((r) => r.destinationFieldId === f.id);
    });

    if (unmappedRequired.length > 0) {
      checks.push({
        category: "Mappings",
        status: "error",
        message: `${unmappedRequired.length} required destination field(s) have no mapping rule`,
        details: unmappedRequired.map((f) => `${f.name} (${f.label ?? f.name})`),
      });
    } else {
      checks.push({
        category: "Mappings",
        status: "ok",
        message: "All required destination fields have mapping rules",
      });
    }
  }

  const allRules = project.mappingSets?.flatMap((ms) => ms.rules) ?? [];
  const unreviewed = allRules.filter((r) => !r.reviewed);
  if (unreviewed.length > 0) {
    checks.push({
      category: "Mappings",
      status: "warning",
      message: `${unreviewed.length} mapping rule(s) not yet reviewed`,
      details: unreviewed.map((r) => {
        const dstField = destProfiles
          .flatMap((p) => p.fields)
          .find((f) => f.id === r.destinationFieldId);
        return dstField?.name ?? r.destinationFieldId;
      }),
    });
  }

  const qualityErrors = allRules.filter((r) => r.qualityStatus === "error");
  if (qualityErrors.length > 0) {
    checks.push({
      category: "Mappings",
      status: "error",
      message: `${qualityErrors.length} mapping rule(s) have quality errors`,
    });
  }

  if (!project.endpoints?.length) {
    checks.push({
      category: "Endpoints",
      status: "error",
      message: "No endpoints defined",
    });
  } else {
    const hasSource = project.endpoints.some((ep) => ep.role === "source");
    const hasDest = project.endpoints.some((ep) => ep.role === "destination");
    if (!hasSource) {
      checks.push({
        category: "Endpoints",
        status: "error",
        message: "No source endpoint defined",
      });
    }
    if (!hasDest) {
      checks.push({
        category: "Endpoints",
        status: "error",
        message: "No destination endpoint defined",
      });
    }
    if (hasSource && hasDest) {
      checks.push({
        category: "Endpoints",
        status: "ok",
        message: `${project.endpoints.length} endpoint(s) defined`,
        details: project.endpoints.map((ep) => `${ep.name} (${ep.role})`),
      });
    }

    const missingConnection = project.endpoints.filter(
      (ep) => !ep.connectionInfo || ep.connectionInfo.trim().length === 0
    );
    if (missingConnection.length > 0) {
      checks.push({
        category: "Endpoints",
        status: "warning",
        message: `${missingConnection.length} endpoint(s) missing connection details`,
        details: missingConnection.map((ep) => ep.name),
      });
    }
  }

  if (!project.processFlows?.length || project.processFlows.every((f) => f.nodes.length === 0)) {
    checks.push({
      category: "Process Flow",
      status: "error",
      message: "No process flow defined",
    });
  } else {
    const totalNodes = project.processFlows.reduce((sum, f) => sum + f.nodes.length, 0);
    checks.push({
      category: "Process Flow",
      status: "ok",
      message: `${totalNodes} node(s) across ${project.processFlows.length} flow(s)`,
    });
  }

  if (!project.folder) {
    checks.push({
      category: "Boomi Context",
      status: "warning",
      message: "No target Boomi folder specified",
      details: ["Companion agent will need target folder name to organize components"],
    });
  }

  if (!project.fmdSections?.length) {
    checks.push({
      category: "FMD",
      status: "warning",
      message: "No FMD sections present",
      details: ["Consider adding an overview section with integration intent"],
    });
  }

  const overallStatus: BuildReadinessReport["overallStatus"] = checks.some(
    (c) => c.status === "error"
  )
    ? "blocked"
    : checks.some((c) => c.status === "warning")
      ? "incomplete"
      : "ready";

  return { checks, overallStatus };
}

function generateOpenQuestions(project: Project): string[] {
  const questions: string[] = [];

  if (!project.folder) {
    questions.push("Which Boomi folder should the components be organized under?");
  }

  const connectionConfigured = project.boomiConnections?.some(
    (c) => c.mode === "sandbox" || c.mode !== "mock"
  );
  if (!connectionConfigured) {
    questions.push(
      "Is there a Boomi sandbox or development environment available for testing?"
    );
  }

  const destProfiles = project.profiles.filter((p) => p.role === "destination");
  const unmappedRequired = destProfiles.flatMap((p) =>
    p.fields.filter((f) => {
      if (!f.required) return false;
      const allRules = project.mappingSets?.flatMap((ms) => ms.rules) ?? [];
      return !allRules.some((r) => r.destinationFieldId === f.id);
    })
  );
  if (unmappedRequired.length > 0) {
    questions.push(
      `${unmappedRequired.length} required destination field(s) need mapping rules — should they use constants, lookups, or cross-reference tables?`
    );
  }

  const unreviewedCount =
    project.mappingSets?.flatMap((ms) => ms.rules).filter((r) => !r.reviewed).length ?? 0;
  if (unreviewedCount > 0) {
    questions.push(
      `${unreviewedCount} mapping rule(s) are unreviewed — can a Boomi architect confirm these before build?`
    );
  }

  const missingConnection = project.endpoints?.filter(
    (ep) => !ep.connectionInfo || ep.connectionInfo.trim().length === 0
  );
  if (missingConnection && missingConnection.length > 0) {
    questions.push(
      `${missingConnection.length} endpoint(s) lack connection details — can a Boomi admin provide connection info before build?`
    );
  }

  return questions;
}

function generateAcceptanceCriteria(project: Project): string[] {
  const criteria: string[] = [];
  const destProfiles = project.profiles.filter((p) => p.role === "destination");
  const destFields = destProfiles.flatMap((p) => p.fields);
  const requiredFields = destFields.filter((f) => f.required);
  const allRules = project.mappingSets?.flatMap((ms) => ms.rules) ?? [];

  criteria.push("All process flow nodes are represented in the created Boomi process");

  if (requiredFields.length > 0) {
    const mapped = requiredFields.filter((f) =>
      allRules.some((r) => r.destinationFieldId === f.id)
    );
    criteria.push(
      `${mapped.length}/${requiredFields.length} required destination fields have mapping rules`
    );
  }

  if (destFields.length > 0) {
    criteria.push("All mapped destination fields are accounted for in the integration");
  }

  if (project.boomiDrafts?.length) {
    criteria.push("Component IDs for all created or updated components are recorded");
  }

  criteria.push("Deployment status is documented before production promotion");
  criteria.push("Test results are recorded for sandbox execution");

  return criteria;
}

export function buildBoomiBuildSpec(project: Project): BoomiBuildSpec {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    sourceApp: "Boomi Helper Suite",
    project: buildProjectSummary(project),
    target: buildTargetIntent(project),
    endpoints: buildEndpoints(project),
    profiles: buildProfiles(project),
    mappingSets: buildMappingSets(project),
    processFlows: buildProcessFlows(project),
    fmdSections: buildFmdSections(project),
    importedBoomiContext: buildImportedBoomiContext(project),
    readiness: generateReadinessReport(project),
    acceptanceCriteria: generateAcceptanceCriteria(project),
    openQuestions: generateOpenQuestions(project),
  };
}
