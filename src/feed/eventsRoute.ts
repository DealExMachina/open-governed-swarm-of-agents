import type { IncomingMessage, ServerResponse } from "http";
import type { PushSubscription } from "../eventBus.js";
import { getPathname, sendJson } from "./http.js";
import { getFeedBus } from "./runtime.js";
import { NATS_STREAM } from "./config.js";

export async function handleEvents(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pathname = getPathname(req.url ?? "/");
  if (req.method !== "GET" || pathname !== "/events") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const bus = await getFeedBus();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const socket = res.socket;
  if (socket) socket.setNoDelay(true);

  // Send an initial event so the client sees something immediately
  const connected = {
    type: "feed_connected",
    ts: new Date().toISOString(),
    source: "feed",
    payload: { message: "Listening for swarm.events.>", stream: NATS_STREAM },
  };
  res.write(`id: 0\ndata: ${JSON.stringify(connected)}\n\n`);

  let sub: PushSubscription | null = null;
  const keepalive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepalive);
      return;
    }
    res.write(": keepalive\n\n");
  }, 25000);

  const onMessage = async (msg: {
    id: string;
    data: Record<string, unknown>;
  }) => {
    if (res.writableEnded) return;
    const line = `id: ${msg.id}\ndata: ${JSON.stringify(msg.data)}\n\n`;
    res.write(line);
  };

  // Ephemeral consumer: no durable name → no accumulation in NATS when clients disconnect
  sub = await bus.subscribeEphemeral(NATS_STREAM, "swarm.events.>", onMessage);

  req.on("close", () => {
    clearInterval(keepalive);
    if (sub) {
      sub.unsubscribe().catch(() => {});
    }
  });
}
