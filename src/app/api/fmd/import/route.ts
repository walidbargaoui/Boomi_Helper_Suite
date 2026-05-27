import { NextRequest, NextResponse } from "next/server";
import { normalizeFmdWorkbook } from "@/lib/fmd";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a workbook file." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const summary = await normalizeFmdWorkbook(buffer, file.name);

  return NextResponse.json(summary);
}
