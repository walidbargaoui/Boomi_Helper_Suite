import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createProject, listProjects, projectCreateSchema } from "@/lib/project-mutations";

export async function GET() {
  try {
    const projects = await listProjects(prisma);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list projects", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const project = await createProject(prisma, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = /unique/i.test(message) ? 409 : 500;
    const userMessage = /unique/i.test(message)
      ? `A project with processId "${parsed.data.processId}" already exists.`
      : message;
    return NextResponse.json({ error: userMessage, detail: message }, { status });
  }
}
