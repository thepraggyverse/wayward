import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";
import { CheckpointManager, RewindService } from "../src/index.js";

class FakeGit implements GitClient {
  calls: string[][] = [];
  async exec(args: string[]) {
    this.calls.push(args);
    if (args.join(" ") === "rev-parse --git-dir") return { stdout: ".git\n", stderr: "" };
    if (args[0] === "write-tree") return { stdout: "tree-sha\n", stderr: "" };
    if (args[0] === "commit-tree") return { stdout: "commit-sha\n", stderr: "" };
    return { stdout: "", stderr: "" };
  }
}

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("checkpoint rewind", () => {
  it("creates checkpoint refs and rewinds without deleting later metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-checkpoints-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const git = new FakeGit();
    const run = await store.createRun({ workflowName: "tournament" });
    const first = await new CheckpointManager(git, store).createCheckpoint(dir, run.id, "before");
    await new CheckpointManager(git, store).createCheckpoint(dir, run.id, "after");

    await new RewindService(git, store).rewind(dir, run.id, first.id);

    const reloaded = await store.getRun(run.id);
    expect(reloaded.state).toBe("rewound");
    expect(reloaded.checkpoints).toHaveLength(2);
    expect(git.calls).toContainEqual(["update-ref", first.gitRef, "commit-sha"]);
    expect(git.calls.at(-1)).toEqual(["restore", "--source", first.gitRef, "--worktree", "--staged", "."]);
  });
});
