import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorktreeManager, type GitClient } from "../src/index.js";

class FakeGit implements GitClient {
  calls: string[][] = [];
  constructor(private readonly failRevParse = false) {}
  async exec(args: string[]) {
    this.calls.push(args);
    if (this.failRevParse && args[0] === "rev-parse") throw new Error("not git");
    return { stdout: "true\n", stderr: "" };
  }
}

describe("WorktreeManager", () => {
  it("creates run-local branches and paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wayward-worktree-"));
    const git = new FakeGit();
    const manager = new WorktreeManager(git);
    const worktree = await manager.createWorktree(repo, { runId: "run-1", jobId: "job-1", baseRef: "main" });

    expect(worktree.branch).toBe("wayward/run-1/job-1");
    expect(worktree.path).toBe(join(repo, ".wayward/worktrees/run-1/job-1"));
    expect(git.calls.at(-1)).toEqual(["worktree", "add", "-b", "wayward/run-1/job-1", join(repo, ".wayward/worktrees/run-1/job-1"), "main"]);
    await rm(repo, { recursive: true, force: true });
  });

  it("rejects worktree-write outside git repositories with an actionable message", async () => {
    const manager = new WorktreeManager(new FakeGit(true));
    await expect(manager.createWorktree("/repo", { runId: "run-1", jobId: "job-1" })).rejects.toThrow("requires a git repository");
  });
});
