import { NextRequest } from "next/server";
import { BUILD_PIPELINES } from "@/lib/boomi-build-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (data: string) => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            closed = true;
          }
        }
      };

      const emitter = BUILD_PIPELINES.get(packageId);

      if (!emitter) {
        safeEnqueue(
          `event: error\ndata: ${JSON.stringify({ message: "No active build pipeline for this package." })}\n\n`,
        );
        if (!closed) {
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
        return;
      }

      safeEnqueue(
        `event: connected\ndata: ${JSON.stringify({ packageId })}\n\n`,
      );

      emitter.replay((event: string, data: unknown) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      });

      const onProgress = (data: unknown) => {
        safeEnqueue(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onComplete = (data: unknown) => {
        safeEnqueue(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };

      const onError = (data: unknown) => {
        safeEnqueue(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };

      emitter.on("progress", onProgress);
      emitter.on("complete", onComplete);
      emitter.on("error", onError);

      if (emitter.hasFinalEvent()) {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      }
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
