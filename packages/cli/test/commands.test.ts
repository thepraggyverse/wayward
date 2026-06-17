import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import { approvalsCommand } from "../src/commands/approvals.js";
import { boardCommand } from "../src/commands/board.js";
import { runCommand } from "../src/commands/run.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("CLI commands", () => {
  it("starts workflows and renders the board from the run store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const output = JSON.parse(await runCommand(["ultrareview", "--repo", dir], store)) as { runId: string };
    const run = await store.getRun(output.runId);

    expect(output.runId).toMatch(/^run-/);
    expect(run.inputs.repo).toBe(dir);
    expect(await boardCommand(store)).toContain("ultrareview");
  });

  it("approves and rejects gates through the CLI command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const run = await store.createRun({ workflowName: "gate" });
    await store.addApproval(run.id, { id: "approval-1", requestedAction: "comment", evidence: ["report-1"], state: "pending" });

    const pending = JSON.parse(await approvalsCommand(["list"], store)) as Array<{ approvalId: string; evidence: string[] }>;
    expect(pending).toEqual([
      expect.objectContaining({ approvalId: "approval-1", evidence: ["report-1"] })
    ]);
    expect(await boardCommand(store)).toContain("pending:approval-1:comment evidence=report-1");

    const approved = JSON.parse(await approvalsCommand(["approve", run.id, "approval-1"], store)) as { runState: string; approval: { state: string } };
    expect(approved.runState).toBe("completed");
    expect(approved.approval.state).toBe("approved");
    expect(await boardCommand(store)).toContain("approved:approval-1:comment evidence=report-1");

    const rejectedRun = await store.createRun({ workflowName: "gate" });
    await store.addApproval(rejectedRun.id, { id: "approval-2", requestedAction: "close-pr", evidence: ["report-2"], state: "pending" });
    const rejected = JSON.parse(await approvalsCommand(["reject", rejectedRun.id, "approval-2"], store)) as { runState: string; approval: { state: string } };
    expect(rejected.runState).toBe("cancelled");
    expect(rejected.approval.state).toBe("rejected");
    expect(await boardCommand(store)).toContain("rejected:approval-2:close-pr evidence=report-2");
  });
});
