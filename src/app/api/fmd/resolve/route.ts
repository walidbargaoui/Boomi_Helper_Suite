import { NextRequest, NextResponse } from "next/server";
import { resolveFmdWorkbook } from "@/lib/fmd-import";

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid form data", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a workbook file." }, { status: 400 });
  }

  const useLlm = formData.get("useLlm") !== "false";
  const model = formData.get("model");
  const baseUrl = formData.get("baseUrl");

  // The resolver internally captures the full Qwen prompt and the raw LLM
  // response as a `debug` field — useful for the in-app "Show resolver context"
  // panel but it can be ~hundreds of KB and could echo back workbook rows
  // (already redacted, but still). Gate it behind an explicit opt-in: either
  // ?debug=true on the URL, debug=true in the form, or BOOMI_HELPER_FMD_DEBUG=1
  // in the env. Default response strips the debug payload.
  const url = new URL(request.url);
  const debugFromQuery = url.searchParams.get("debug") === "true";
  const debugFromForm = formData.get("debug") === "true";
  const debugFromEnv = process.env.BOOMI_HELPER_FMD_DEBUG === "1";
  const includeDebug = debugFromQuery || debugFromForm || debugFromEnv;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await resolveFmdWorkbook(buffer, file.name, {
      useLlm,
      model: typeof model === "string" && model.trim() ? model.trim() : undefined,
      baseUrl: typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : undefined,
    });
    if (!includeDebug && result.debug) {
      const { debug: _debug, ...rest } = result;
      void _debug;
      return NextResponse.json(rest);
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to resolve workbook",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
