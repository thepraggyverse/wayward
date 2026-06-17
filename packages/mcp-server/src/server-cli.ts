import { WaywardMcpUserError, callWaywardMcpTool, createWaywardMcpTools, getWaywardMcpToolDefinitions, toMcpError } from "./server.js";

const tools = createWaywardMcpTools();
process.stdin.setEncoding("utf8");

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines.filter(Boolean)) void handleMessage(line);
});

async function handleMessage(line: string): Promise<void> {
  let message: { id?: string | number; method?: string; params?: Record<string, unknown> };
  try {
    message = JSON.parse(line) as { id?: string | number; method?: string; params?: Record<string, unknown> };
  } catch (error) {
    respondError(null, -32700, toMcpError(error).message);
    return;
  }
  if (message.id === undefined || message.id === null) return;
  try {
    if (message.method === "initialize") {
      respond(message.id, { protocolVersion: "2024-11-05", serverInfo: { name: "wayward", version: "0.1.0" }, capabilities: { tools: {} } });
      return;
    }
    if (message.method === "tools/list") {
      respond(message.id, { tools: getWaywardMcpToolDefinitions() });
      return;
    }
    if (message.method === "tools/call") {
      const params = message.params as { name?: unknown; arguments?: Record<string, unknown> };
      if (typeof params?.name !== "string") throw new WaywardMcpUserError("tools/call requires params.name.");
      const result = await callWaywardMcpTool(tools, params.name, params.arguments);
      respond(message.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      return;
    }
    respondError(message.id, -32601, `Unknown method ${message.method}`);
  } catch (error) {
    const payload = toMcpError(error);
    respondError(message.id, payload.code, payload.message);
  }
}

function respond(id: string | number | null, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: string | number | null, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
