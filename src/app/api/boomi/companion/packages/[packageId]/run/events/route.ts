import { NextRequest } from "next/server";
import {
  BRIDGE_EVENT_EMITTERS,
  type PipelineStep,
} from "@/lib/boomi-bridge-pipeline";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;

  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function sendEvent(event: string, data: unknown) {
        if (closed) return;
        try {
          const json = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${json}\n\n`),
          );
        } catch {
          // client disconnected
        }
      }

      const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
      if (!emitter) {
        sendEvent("error", {
          message:
            "No pipeline found for this package. Start a Companion run first.",
        });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
        return;
      }

      sendEvent("connected", {
        packageId,
        status: emitter.pipelineStatus,
        bufferLength: emitter.buffer.length,
        hasFinalEvent: emitter.hasFinalEvent(),
      });

      emitter.replay((event, data) => {
        sendEvent(event, data);
      });

      if (emitter.hasFinalEvent()) {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
        return;
      }

      const onProgress = (step: PipelineStep) => {
        sendEvent("progress", step);
      };

      const onComplete = (data: unknown) => {
        sendEvent("complete", data);
      };

      const onResult = (data: unknown) => {
        sendEvent("result", data);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      const onError = (data: { message: string; step?: PipelineStep }) => {
        sendEvent("error", data);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      emitter.on("progress", onProgress);
      emitter.on("complete", onComplete);
      emitter.on("result", onResult);
      emitter.on("error", onError);

      _request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          emitter.off("progress", onProgress);
          emitter.off("complete", onComplete);
          emitter.off("result", onResult);
          emitter.off("error", onError);
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
