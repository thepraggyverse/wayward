import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface GitClient {
  exec(args: string[], options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string }>;
}

export class RealGitClient implements GitClient {
  async exec(args: string[], options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000);
      }, options.timeoutMs ?? 30_000);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || `git ${args.join(" ")} exited ${code}`));
      });
    });
  }
}

export interface WorktreeMetadata {
  runId: string;
  jobId: string;
  path: string;
  branch: string;
  baseRef: string;
}

export class WorktreeManager {
  constructor(
    private readonly git: GitClient = new RealGitClient(),
    private readonly rootDir = ".wayward/worktrees"
  ) {}

  async createWorktree(repoPath: string, input: { runId: string; jobId: string; baseRef?: string }): Promise<WorktreeMetadata> {
    await this.ensureGitRepository(repoPath);
    const baseRef = input.baseRef ?? "HEAD";
    const branch = `wayward/${input.runId}/${input.jobId}`;
    const path = join(repoPath, this.rootDir, input.runId, input.jobId);
    await mkdir(join(repoPath, this.rootDir, input.runId), { recursive: true });
    await this.git.exec(["worktree", "add", "-b", branch, path, baseRef], { cwd: repoPath });
    return { runId: input.runId, jobId: input.jobId, path, branch, baseRef };
  }

  async removeWorktree(repoPath: string, path: string): Promise<void> {
    await this.git.exec(["worktree", "remove", path], { cwd: repoPath });
  }

  async ensureGitRepository(repoPath: string): Promise<void> {
    try {
      await this.git.exec(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath });
    } catch {
      throw new Error("Wayward worktree-write mode requires a git repository. Run inside a repo or use inspect mode.");
    }
  }
}
