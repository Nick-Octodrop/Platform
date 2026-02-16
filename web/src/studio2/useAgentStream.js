import { API_URL, getAuthHeaders } from "../api.js";

function flushState(state, onEvent) {
  if (state.eventName && state.dataLines.length > 0) {
    const dataText = state.dataLines.join("\n");
    try {
      const payload = JSON.parse(dataText);
      onEvent({ event: state.eventName, ...payload });
    } catch (err) {
      // ignore parse errors
    }
  }
  state.eventName = null;
  state.dataLines = [];
}

function parseSseChunk(text, state, onEvent) {
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line === "") {
      flushState(state, onEvent);
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      state.eventName = line.replace("event:", "").trim();
      continue;
    }
    if (line.startsWith("data:")) {
      state.dataLines.push(line.replace("data:", "").trim());
    }
  }
}

export function startAgentStream({
  moduleId,
  message,
  chatHistory = null,
  buildSpec = null,
  onEvent,
}) {
  const controller = new AbortController();
  const state = { eventName: null, dataLines: [] };

  const promise = (async () => {
    const handleEvent = (evt) => {
      if (evt?.event) {
        const reqId = evt.request_id || evt.requestId;
        // Debug log to confirm SSE event flow (including done).
        console.debug("agent stream event", evt.event, reqId || "");
      }
      if (onEvent) onEvent(evt);
    };
    // Stream must include Authorization or it 401s and falls back.
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/studio2/agent/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        module_id: moduleId,
        message,
        chat_history: chatHistory,
        build_spec: buildSpec || undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Stream failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        parseSseChunk(part, state, (evt) => {
          handleEvent(evt);
          if (evt.event === "done") {
            donePayload = evt.data?.final_payload || evt.data?.finalPayload || evt.data?.payload || null;
          }
        });
      }
      if (donePayload) break;
    }
    if (buffer.trim()) {
      parseSseChunk(buffer, state, (evt) => {
        handleEvent(evt);
        if (evt.event === "done") {
          donePayload = evt.data?.final_payload || evt.data?.finalPayload || evt.data?.payload || null;
        }
      });
    }
    if (!donePayload) {
      flushState(state, (evt) => {
        handleEvent(evt);
        if (evt.event === "done") {
          donePayload = evt.data?.final_payload || evt.data?.finalPayload || evt.data?.payload || null;
        }
      });
    }
    if (!donePayload) {
      throw new Error("Stream ended without done event");
    }
    return donePayload;
  })();

  return {
    cancel: () => controller.abort(),
    promise,
  };
}
