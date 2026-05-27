import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { randomUUID } from "crypto";

const createFlowSchema = z.object({
  name: z.string().min(1).max(200),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum([
      "start", "start-connector", "start-trading", "start-passthrough", "start-nodata",
      "connector", "map", "setproperties", "message", "notify", "programcmd",
      "subprocess", "processroute", "dataprocess", "agent",
      "branch", "route", "cleanse", "decision", "exception", "stop", "end", "return", "flowcontrol",
      "trycatch", "businessrules", "findchanges", "addtocache", "retrievefromcache", "removefromcache",
    ]),
    label: z.string(),
    description: z.string().default(""),
    position: z.object({ x: z.number(), y: z.number() }),
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
  })),
  notes: z.string().max(5000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createFlowSchema.safeParse(body);

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const flow = await prisma.processFlow.create({
    data: {
      id: randomUUID(),
      projectId,
      name: parsed.data.name,
      nodesJson: JSON.stringify(parsed.data.nodes),
      edgesJson: JSON.stringify(parsed.data.edges),
      notes: parsed.data.notes ?? null,
    },
  });

  return NextResponse.json({
    flow: {
      id: flow.id,
      name: flow.name,
      nodes: parsed.data.nodes,
      edges: parsed.data.edges,
      notes: flow.notes ?? undefined,
    },
  }, { status: 201 });
}
