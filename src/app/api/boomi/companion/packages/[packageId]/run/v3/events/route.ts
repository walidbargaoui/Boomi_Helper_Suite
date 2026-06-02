import { NextRequest } from "next/server";
import {
  getCompanionV3Run,
  getLatestCompanionV3RunForPackage,
  type CompanionV3Progress,
  type CompanionV3LogEvent,
} from "@/lib/boomi-companion-v3";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;
  const runId = request.nextUrl.searchParams.get("runId");
  const run = runId ? getCompanionV3Run(runId) : getLatestCompanionV3RunForPackage(packageId);
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function sendEvent(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      }

      if (!run || run.packageId !== packageId) {
        sendEvent("error", { message: "No v3 run found for this package. Start preflight first." });
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      sendEvent("connected", {
        packageId,
        runId: run.runId,
        status: run.status,
        bufferLength: run.emitter.buffer.length,
        hasFinalEvent: run.emitter.hasFinalEvent(),
      });

      run.emitter.replay((event, data) => {
        sendEvent(event, data);
      });

      if (run.emitter.hasFinalEvent()) {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      const onProgress = (step: CompanionV3Progress) => sendEvent("progress", step);
      const onPlan = (plan: unknown) => sendEvent("plan", plan);
      const onLog = (log: CompanionV3LogEvent) => sendEvent("log", log);
      const onResult = (result: unknown) => sendEvent("result", result);
      const closeWith = (event: string, data: unknown) => {
        sendEvent(event, data);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };
      const onComplete = (data: unknown) => closeWith("complete", data);
      const onError = (data: unknown) => closeWith("error", data);

      run.emitter.on("progress", onProgress);
      run.emitter.on("plan", onPlan);
      run.emitter.on("log", onLog);
      run.emitter.on("result", onResult);
      run.emitter.on("complete", onComplete);
      run.emitter.on("error", onError);

      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          run.emitter.off("progress", onProgress);
          run.emitter.off("plan", onPlan);
          run.emitter.off("log", onLog);
          run.emitter.off("result", onResult);
          run.emitter.off("complete", onComplete);
          run.emitter.off("error", onError);
        },
        { once: true },
      );
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
