import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import { createWaywardMcpTools } from "../src/index.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("Wayward MCP tools", () => {
  it("maps tools to the same core services as the CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-mcp-"));
    tempDirs.push(dir);
    const tools = createWaywardMcpTools(new FileRunStore(join(dir, "runs")));

    const run = await tools.createRun({ workflow: "tournament", inputs: { attempts: 2 } });
    const checkpoint = await tools.createCheckpoint({ runId: run.runId, label: "before", gitRef: "refs/test" });
    const approval = await tools.requestApproval({ runId: run.runId, requestedAction: "comment-on-pr", evidence: ["report"] });

    expect(await tools.listRuns()).toHaveLength(1);
    expect(await tools.readReport({ runId: run.runId })).toBeTruthy();
    expect(checkpoint.gitRef).toBe("refs/test");
    expect(approval.state).toBe("pending");
  });
});
