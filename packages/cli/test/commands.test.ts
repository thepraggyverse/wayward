import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";
import { approvalsCommand } from "../src/commands/approvals.js";
import { boardCommand } from "../src/commands/board.js";
import { branchCommand } from "../src/commands/branch.js";
import { checkpointsCommand } from "../src/commands/checkpoints.js";
import { runCommand } from "../src/commands/run.js";

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

  it("creates and lists checkpoints through the CLI command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const git = new FakeGit();
    const run = await store.createRun({ workflowName: "checkpointable" });

    const created = JSON.parse(await checkpointsCommand(["create", run.id, "before edit"], store, { repoPath: dir, git })) as { id: string; label: string };
    const listed = JSON.parse(await checkpointsCommand(["list", run.id], store)) as Array<{ id: string; label: string }>;
    const board = await boardCommand(store);

    expect(created.label).toBe("before edit");
    expect(listed).toEqual([expect.objectContaining({ id: created.id, label: "before edit" })]);
    expect(board).toContain(`checkpoints:${created.id}:before edit:refs/wayward/${run.id}/${created.id}`);
  });

  it("branches from a checkpoint and records the worktree path in the run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const git = new FakeGit();
    const run = await store.createRun({ workflowName: "branchable" });
    const checkpoint = JSON.parse(await checkpointsCommand(["create", run.id, "branch base"], store, { repoPath: dir, git })) as { id: string; gitRef: string };

    const branched = JSON.parse(await branchCommand([run.id, "--checkpoint", checkpoint.id, "--name", "try-fix"], store, { repoPath: dir, git })) as { worktreePath: string; branch: string; baseRef: string };
    const reloaded = await store.getRun(run.id);

    expect(branched.branch).toBe(`wayward/${run.id}/try-fix`);
    expect(branched.baseRef).toBe(checkpoint.gitRef);
    expect(reloaded.worktreePaths).toEqual([branched.worktreePath]);
    expect(git.calls.at(-1)).toEqual(["worktree", "add", "-b", `wayward/${run.id}/try-fix`, branched.worktreePath, checkpoint.gitRef]);
    expect(await boardCommand(store)).toContain(`worktrees:${branched.worktreePath}`);
  });
});
