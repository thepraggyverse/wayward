import { createWaywardMcpTools } from "./server.js";

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
  const message = JSON.parse(line) as { id?: string | number; method?: string; params?: Record<string, unknown> };
  if (!message.id) return;
  try {
    if (message.method === "initialize") {
      respond(message.id, { protocolVersion: "2024-11-05", serverInfo: { name: "wayward", version: "0.1.0" }, capabilities: { tools: {} } });
      return;
    }
    if (message.method === "tools/list") {
      respond(message.id, {
        tools: Object.keys(tools).map((name) => ({
          name,
          description: `Wayward ${name} tool`,
          inputSchema: { type: "object", additionalProperties: true }
        }))
      });
      return;
    }
    if (message.method === "tools/call") {
      const params = message.params as { name: keyof typeof tools; arguments?: Record<string, unknown> };
      const result = await tools[params.name](params.arguments as never);
      respond(message.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      return;
    }
    respondError(message.id, -32601, `Unknown method ${message.method}`);
  } catch (error) {
    respondError(message.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function respond(id: string | number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: string | number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
