import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptValue, maskValue } from "@/lib/boomi-crypto";
import { deleteProject, projectUpdateSchema, updateProject } from "@/lib/project-mutations";
import { markSectionsStale } from "@/lib/fmd-mutations";

/**
 * Inline credential + payload scrubber for the Prisma row shape returned by
 * this route. Mirrors sanitizeProjectForClient in db.ts but operates on the
 * raw Prisma row so we don't have to round-trip through the full domain mapper.
 *
 * Two responsibilities:
 *  1. Mask `apiUsername` / `apiPassword` on every boomi connection.
 *  2. Drop `requestXml` / `responseXml` from publish events (they can each be
 *     tens of KB of Component XML — the list view doesn't need them; fetch
 *     full event details from /api/boomi/publish/events/[eventId] on demand).
 */
function scrubPrismaProjectForClient<
  T extends {
    boomiConnections?: Array<{ apiUsername: string; apiPassword: string }>;
    boomiPublishEvents?: Array<{
      requestXml?: string | null;
      responseXml?: string | null;
      errorDetail?: string | null;
    }>;
    fmdSections?: Array<{
      id: string;
      title: string;
      sectionType: string;
      contentJson: string;
      sortOrder: number;
    }>;
  },
>(row: T): T {
  const next = { ...row } as T;
  if (row.boomiConnections) {
    next.boomiConnections = row.boomiConnections.map((conn) => {
      let usernameDisplay = "";
      try {
        usernameDisplay = maskValue(decryptValue(conn.apiUsername));
      } catch {
        usernameDisplay = conn.apiUsername ? "[re-enter credentials]" : "";
      }
      return { ...conn, apiUsername: usernameDisplay, apiPassword: conn.apiPassword ? "••••••••" : "" };
    }) as T["boomiConnections"];
  }
  if (row.boomiPublishEvents) {
    next.boomiPublishEvents = row.boomiPublishEvents.map((event) => ({
      ...event,
      requestXml: "",
      responseXml: null,
      errorDetail:
        event.errorDetail && event.errorDetail.length > 500
          ? `${event.errorDetail.slice(0, 500)}…`
          : event.errorDetail,
      hasRequestXml: Boolean(event.requestXml && event.requestXml.trim().length > 0),
      hasResponseXml: Boolean(event.responseXml && event.responseXml.trim().length > 0),
    })) as T["boomiPublishEvents"];
  }
  if (row.fmdSections) {
    next.fmdSections = row.fmdSections.map((section) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { contentJson, ...rest } = section;
      return {
        ...rest,
        content: (() => {
          try {
            return JSON.parse(section.contentJson);
          } catch {
            return {};
          }
        })(),
      };
    }) as unknown as T["fmdSections"];
  }
  return next;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        endpoints: true,
        profiles: { include: { fields: { orderBy: { ordinal: "asc" } } } },
        mappingSets: { include: { rules: true, transformNodes: true } },
        processFlows: true,
        fmdSections: { orderBy: { sortOrder: "asc" } },
        boomiConnections: true,
        boomiDrafts: true,
        boomiPublishEvents: { orderBy: { publishedAt: "desc" } },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project: scrubPrismaProjectForClient(project) });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = projectUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project payload", issues: parsed.error.issues }, { status: 400 });
  }
  // Optimistic concurrency: prefer If-Match header, fall back to body.version.
  const ifMatch = request.headers.get("if-match");
  const bodyVersion = typeof (json as { version?: unknown })?.version === "number"
    ? (json as { version: number }).version
    : undefined;
  const expectedVersion = ifMatch !== null && !Number.isNaN(Number(ifMatch))
    ? Number(ifMatch)
    : bodyVersion;
  try {
    const { ProjectVersionMismatchError } = await import("@/lib/project-mutations");
    try {
      const project = await updateProject(prisma, projectId, parsed.data, { expectedVersion });
      markSectionsStale(projectId).catch(() => {});
      return NextResponse.json({ project });
    } catch (error) {
      if (error instanceof ProjectVersionMismatchError) {
        return NextResponse.json(
          {
            error: error.message,
            expected: error.expected,
            actual: error.actual,
            code: "VERSION_MISMATCH",
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    await deleteProject(prisma, projectId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
