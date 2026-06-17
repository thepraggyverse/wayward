import type { CliRunner } from "./cli-runner.js";

export interface CodexCapabilities {
  execJson: boolean;
  review: boolean;
  fork: boolean;
  appServer: boolean;
}

export async function detectCodexCapabilities(runner: CliRunner, cwd: string): Promise<CodexCapabilities> {
  try {
    const result = await runner.run("codex", ["--help"], { cwd });
    const help = `${result.stdout}\n${result.stderr}`;
    return {
      execJson: help.includes("exec"),
      review: help.includes("review"),
      fork: help.includes("fork"),
      appServer: help.includes("app-server")
    };
  } catch {
    return { execJson: false, review: false, fork: false, appServer: false };
  }
}
