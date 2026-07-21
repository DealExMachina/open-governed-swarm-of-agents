import { appendEvent } from "../contextWal.js";
import { createSwarmEvent } from "../events.js";
import { getFeedBus } from "./runtime.js";

export async function ingestContextDoc(
  scopeId: string,
  title: string,
  text: string,
): Promise<number> {
  const event = createSwarmEvent(
    "context_doc",
    { title, text, source: "studio", scope_id: scopeId },
    { source: "feed" },
  );
  const seq = await appendEvent(event as unknown as Record<string, unknown>);
  const bus = await getFeedBus();
  await bus.publishEvent(event);
  return seq;
}
