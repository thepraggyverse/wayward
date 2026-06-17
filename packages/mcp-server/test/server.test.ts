import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";
import { callWaywardMcpTool, createWaywardMcpTools, getWaywardMcpToolDefinitions, toMcpError } from "../src/index.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

class FakeGit implements GitClient {
  calls: string[][] = [];

  async exec(args: string[]) {
    this.calls.push(args);
    if (args.join(" ") === "rev-parse --git-dir") return { stdout: ".git\n", stderr: "" };
    if (args.join(" ") === "rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
    if (args[0] === "write-tree") return { stdout: "tree-sha\n", stderr: "" };
    if (args[0] === "commit-tree") return { stdout: "commit-sha\n", stderr: "" };
    return { stdout: "", stderr: "" };
  }
}

describe("Wayward MCP tools", () => {
  it("exposes explicit stable schemas for the runtime tool surface", () => {
    const definitions = getWaywardMcpToolDefinitions();

    expect(definitions.map((tool) => tool.name)).toEqual([
      "createRun",
      "listRuns",
      "readRun",
      "readReport",
      "listPendingApprovals",
      "decideApproval",
      "listCheckpoints",
      "createCheckpoint",
      "rewind",
      "branchFromCheckpoint",
      "requestApproval"
    ]);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "createRun",
          inputSchema: expect.objectContaining({
            type: "object",
            additionalProperties: false,
            required: ["workflow"]
          })
        }),
        expect.objectContaining({
          name: "decideApproval",
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              decision: expect.objectContaining({ enum: ["approved", "rejected"] })
            })
          })
        }),
        expect.objectContaining({
          name: "branchFromCheckpoint",
          inputSchema: expect.objectContaining({
            required: ["runId", "checkpointId"]
          })
        })
      ])
    );
  });

  it("maps MCP calls to the shared runtime, checkpoint, approval, and worktree services", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-mcp-"));
    tempDirs.push(dir);
    const git = new FakeGit();
    const tools = createWaywardMcpTools(new FileRunStore(join(dir, "runs")), {
      git,
      cwd: dir,
      getWorkflow: () => ({
        name: "test-report",
        phases: [
          {
            id: "synthesize",
            kind: "synthesize",
            async run() {
              return { summary: "MCP smoke report" };
            }
          }
        ]
      })
    });

    const runResult = await tools.createRun({ workflow: "test-report", inputs: { prs: [1] }, mode: "inspect" }) as { runId: string };
    const listed = await tools.listRuns({ workflow: "test-report", state: "completed" }) as Array<{ id: string }>;
    const runDetail = await tools.readRun({ runId: runResult.runId, includeEvents: true }) as { run: { id: string }; events: unknown[] };
    const report = await tools.readReport({ runId: runResult.runId }) as { markdown: string };
    const checkpoint = await tools.createCheckpoint({ runId: runResult.runId, label: "before edit", repoPath: dir }) as { id: string; gitRef: string };
    const checkpoints = await tools.listCheckpoints({ runId: runResult.runId }) as Array<{ id: string }>;
    const branched = await tools.branchFromCheckpoint({ runId: runResult.runId, checkpointId: checkpoint.id, repoPath: dir, name: "try fix" }) as { branch: string; baseRef: string; checkpointId: string };
    const approval = await tools.requestApproval({ runId: runResult.runId, requestedAction: "comment-on-pr", evidence: ["report"] }) as { id: string; state: string };
    const pending = await tools.listPendingApprovals() as Array<{ approvalId: string; evidence: string[] }>;
    const decision = await tools.decideApproval({ runId: runResult.runId, approvalId: approval.id, decision: "approved", actor: "tester" }) as { runState: string; approval: { state: string; actor: string } };
    const rewind = await tools.rewind({ runId: runResult.runId, checkpointId: checkpoint.id, repoPath: dir }) as { state: string; checkpointId: string };

    expect(listed).toEqual([expect.objectContaining({ id: runResult.runId })]);
    expect(runDetail.run.id).toBe(runResult.runId);
    expect(runDetail.events.length).toBeGreaterThan(0);
    expect(report.markdown).toContain("MCP smoke report");
    expect(checkpoint.gitRef).toBe(`refs/wayward/${runResult.runId}/${checkpoint.id}`);
    expect(checkpoints).toEqual([expect.objectContaining({ id: checkpoint.id })]);
    expect(branched).toMatchObject({
      branch: `wayward/${runResult.runId}/try-fix`,
      baseRef: checkpoint.gitRef,
      checkpointId: checkpoint.id
    });
    expect(approval.state).toBe("pending");
    expect(pending).toEqual([
      expect.objectContaining({ approvalId: approval.id, evidence: ["report"] })
    ]);
    expect(decision).toMatchObject({ runState: "completed", approval: { state: "approved", actor: "tester" } });
    expect(rewind).toMatchObject({ state: "rewound", checkpointId: checkpoint.id });
    expect(git.calls).toContainEqual(["worktree", "add", "-b", `wayward/${runResult.runId}/try-fix`, join(dir, ".wayward", "worktrees", runResult.runId, "try-fix"), checkpoint.gitRef]);
    expect(git.calls).toContainEqual(["read-tree", "--reset", "-u", checkpoint.gitRef]);
  });

  it("reports useful MCP errors without stack frames", async () => {
    const tools = createWaywardMcpTools();

    await expect(callWaywardMcpTool(tools, "missingTool", {})).rejects.toThrow("Unknown Wayward MCP tool missingTool.");
    expect(toMcpError(new Error("boom\n    at /private/path/server.ts:10:1")).message).toBe("boom");
  });
});
