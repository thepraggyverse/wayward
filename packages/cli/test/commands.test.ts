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
    expect(await boardCommand([], store)).toContain("workflow: ultrareview");
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
    const pendingBoard = await boardCommand([], store);
    expect(pendingBoard).toContain(`run: ${run.id}`);
    expect(pendingBoard).toContain("state: needs_approval [ACTION REQUIRED]");
    expect(pendingBoard).toContain("pending approvals: 1");
    expect(await runCommand(["show", run.id], store)).toContain("id=approval-1 state=pending action=comment actor=- decided=- evidence=report-1");

    const approved = JSON.parse(await approvalsCommand(["approve", run.id, "approval-1"], store)) as { runState: string; approval: { state: string } };
    expect(approved.runState).toBe("completed");
    expect(approved.approval.state).toBe("approved");
    const approvedBoard = await boardCommand([], store);
    expect(approvedBoard).toContain("state: completed [COMPLETED]");
    expect(approvedBoard).toContain("pending approvals: 0");
    expect(await runCommand(["show", run.id], store)).toContain("id=approval-1 state=approved action=comment");

    const rejectedRun = await store.createRun({ workflowName: "gate" });
    await store.addApproval(rejectedRun.id, { id: "approval-2", requestedAction: "close-pr", evidence: ["report-2"], state: "pending" });
    const rejected = JSON.parse(await approvalsCommand(["reject", rejectedRun.id, "approval-2"], store)) as { runState: string; approval: { state: string } };
    expect(rejected.runState).toBe("cancelled");
    expect(rejected.approval.state).toBe("rejected");
    expect(await boardCommand([], store)).toContain("state: cancelled [CANCELLED]");
    expect(await runCommand(["show", rejectedRun.id], store)).toContain("id=approval-2 state=rejected action=close-pr");
  });

  it("creates and lists checkpoints through the CLI command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const git = new FakeGit();
    const run = await store.createRun({ workflowName: "checkpointable" });

    const created = JSON.parse(await checkpointsCommand(["create", run.id, "before edit"], store, { repoPath: dir, git })) as { id: string; label: string };
    const listed = JSON.parse(await checkpointsCommand(["list", run.id], store)) as Array<{ id: string; label: string }>;
    const board = await boardCommand([], store);
    const detail = await runCommand(["show", run.id], store);

    expect(created.label).toBe("before edit");
    expect(listed).toEqual([expect.objectContaining({ id: created.id, label: "before edit" })]);
    expect(board).toContain("checkpoints: 1");
    expect(detail).toContain(`id=${created.id} label="before edit" git_ref=refs/wayward/${run.id}/${created.id}`);
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
    expect(await boardCommand([], store)).toContain("worktrees: 1");
    expect(await runCommand(["show", run.id], store)).toContain(branched.worktreePath);
  });

  it("filters board runs by state, workflow, and limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const needsApproval = await store.createRun({ workflowName: "open-pr-audit" });
    await store.addApproval(needsApproval.id, { id: "approval-1", requestedAction: "external-action-gate", evidence: [], state: "pending" });
    const completed = await store.createRun({ workflowName: "ultrareview" });
    await store.setRunState(completed.id, "completed");
    const failed = await store.createRun({ workflowName: "tournament" });
    await store.upsertJob(failed.id, { id: "attempt-1", adapter: "codex", state: "running" });
    await store.setJobState(failed.id, "attempt-1", "failed", "attempt exploded");
    await store.setRunState(failed.id, "failed", { error: "ranking failed" });

    const byState = await boardCommand(["--state", "needs_approval"], store);
    expect(byState).toContain(`run: ${needsApproval.id}`);
    expect(byState).not.toContain(`run: ${completed.id}`);
    expect(byState).not.toContain(`run: ${failed.id}`);
    expect(byState).toContain("filters: state=needs_approval workflow=- limit=-");

    const byWorkflow = await boardCommand(["--workflow", "open-pr-audit"], store);
    expect(byWorkflow).toContain(`run: ${needsApproval.id}`);
    expect(byWorkflow).not.toContain(`run: ${completed.id}`);
    expect(byWorkflow).not.toContain(`run: ${failed.id}`);
    expect(byWorkflow).toContain("workflow: open-pr-audit");

    const limited = await boardCommand(["--limit", "1"], store);
    expect(runLineCount(limited)).toBe(1);
    expect(await boardCommand(["--state", "failed"], store)).toContain("latest failure: run.state_changed: ranking failed");
  });

  it("renders run detail with jobs, reports, approvals, artifacts, checkpoints, worktrees, and recent events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-cli-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const run = await store.createRun({ workflowName: "open-pr-audit", inputs: { repo: dir } });
    await store.upsertJob(run.id, { id: "audit-job", adapter: "codex", state: "running", startedAt: "2026-06-18T00:00:00.000Z" });
    await store.writeArtifact(run.id, { id: "gh-pr-list-raw", kind: "gh-raw", sourceJobId: "audit-job" }, "{}\n");
    await store.setJobState(run.id, "audit-job", "failed", "gh unavailable");
    const report = await store.writeReport(run.id, "Open PR Audit", "# Open PR Audit\n", ["gh-pr-list-raw"]);
    await store.addApproval(run.id, { id: "approval-1", requestedAction: "external-action-gate", evidence: [report.id, "gh-pr-list-raw"], state: "pending" });
    await store.addCheckpoint(run.id, { id: "checkpoint-1", label: "before audit", gitRef: "refs/wayward/run/checkpoint-1", createdAt: "2026-06-18T00:00:01.000Z" });
    await store.addWorktreePath(run.id, join(dir, ".wayward", "worktrees", run.id, "attempt-1"));

    const detail = await runCommand(["show", run.id], store);

    expect(detail).toContain(`Run ${run.id}`);
    expect(detail).toContain("metadata:");
    expect(detail).toContain("state: needs_approval [ACTION REQUIRED]");
    expect(detail).toContain("jobs:");
    expect(detail).toContain("id=audit-job state=failed adapter=codex");
    expect(detail).toContain("reports:");
    expect(detail).toContain(`id=${report.id} title="Open PR Audit"`);
    expect(detail).toContain("approvals:");
    expect(detail).toContain(`id=approval-1 state=pending action=external-action-gate actor=- decided=- evidence=${report.id},gh-pr-list-raw`);
    expect(detail).toContain("artifacts by type:");
    expect(detail).toContain("gh-raw (1)");
    expect(detail).toContain("id=gh-pr-list-raw source_job=audit-job");
    expect(detail).toContain("checkpoints:");
    expect(detail).toContain('id=checkpoint-1 label="before audit"');
    expect(detail).toContain("worktrees:");
    expect(detail).toContain(join(dir, ".wayward", "worktrees", run.id, "attempt-1"));
    expect(detail).toContain("recent events:");
    expect(detail).toContain("approval.requested");
  });
});

function runLineCount(output: string): number {
  return output.split("\n").filter((line) => line.startsWith("run: ")).length;
}
