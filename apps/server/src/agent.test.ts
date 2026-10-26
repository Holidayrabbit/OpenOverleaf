import assert from "node:assert/strict";
import test from "node:test";
import { MISSING_KEY_MESSAGE, runAgent } from "./agent/loop.js";
import type { AgentEvent } from "./agent/types.js";

test("agent explains a missing API key", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  try {
    const events: AgentEvent[] = [];
    await runAgent({
      messages: [{ role: "user", content: "Add a conclusion." }],
      signal: AbortSignal.timeout(5_000),
      emit: (event) => events.push(event),
    });
    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event.type === "text" ? event.delta : ""))
      .join("");
    assert.equal(text, MISSING_KEY_MESSAGE);
    assert.match(text, /OPENAI_API_KEY/);
    assert.equal(events.at(-1)?.type, "done");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
