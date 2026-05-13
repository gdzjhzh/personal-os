type StreamEvent = {
  type: string;
};

export type EventStreamSend<TEvent extends StreamEvent> = <
  TType extends TEvent["type"],
>(
  event: TType,
  data: Extract<TEvent, { type: TType }>,
) => void;

const encoder = new TextEncoder();

export function eventStream<TEvent extends StreamEvent>(
  start: (
    send: EventStreamSend<TEvent>,
    close: () => void,
    signal: AbortSignal,
  ) => void,
) {
  const streamAbort = new AbortController();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send<TType extends TEvent["type"]>(
        event: TType,
        data: Extract<TEvent, { type: TType }>,
      ) {
        if (closed || streamAbort.signal.aborted) {
          return;
        }

        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
          streamAbort.abort();
        }
      }

      function close() {
        if (closed) {
          return;
        }

        closed = true;

        try {
          controller.close();
        } catch {
          // The client may have closed the connection first.
        }
      }

      start(send, close, streamAbort.signal);
    },
    cancel() {
      closed = true;
      streamAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
