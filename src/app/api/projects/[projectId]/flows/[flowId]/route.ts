import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string; flowId: string }> }) {
  const { projectId, flowId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const flow = await prisma.processFlow.findUnique({ where: { id: flowId } });
  if (!flow || flow.projectId !== projectId) {
    return NextResponse.json({ error: "Flow not found." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name;
  if (body.nodes) data.nodesJson = JSON.stringify(body.nodes);
  if (body.edges) data.edgesJson = JSON.stringify(body.edges);
  if (body.notes !== undefined) data.notes = body.notes ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.processFlow.update({ where: { id: flowId }, data });

  return NextResponse.json({
    flow: {
      id: updated.id,
      name: updated.name,
      nodes: JSON.parse(updated.nodesJson),
      edges: JSON.parse(updated.edgesJson),
      notes: updated.notes ?? undefined,
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ projectId: string; flowId: string }> }) {
  const { projectId, flowId } = await params;
  const flow = await prisma.processFlow.findUnique({ where: { id: flowId } });
  if (!flow || flow.projectId !== projectId) {
    return NextResponse.json({ error: "Flow not found." }, { status: 404 });
  }
  await prisma.processFlow.delete({ where: { id: flowId } });
  return NextResponse.json({ success: true });
}
