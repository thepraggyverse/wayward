#!/usr/bin/env tsx
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { approvalsCommand } from "./commands/approvals.js";
import { boardCommand } from "./commands/board.js";
import { branchCommand } from "./commands/branch.js";
import { checkpointsCommand } from "./commands/checkpoints.js";
import { rewindCommand } from "./commands/rewind.js";
import { runCommand } from "./commands/run.js";

export async function main(argv = process.argv.slice(2)): Promise<string> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") return "Usage: wayward run|board|checkpoints|rewind|branch|approvals";
  if (command === "run" || command === "ultrareview" || command === "pr-audit" || command === "tournament") {
    return runCommand(command === "run" ? args : [command, ...args]);
  }
  if (command === "board") return boardCommand();
  if (command === "checkpoints") return checkpointsCommand(args);
  if (command === "rewind") return rewindCommand(args);
  if (command === "branch") return branchCommand(args);
  if (command === "approvals") return approvalsCommand(args);
  throw new Error(`Unknown command ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
