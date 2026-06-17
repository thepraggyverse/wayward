import { FileRunStore } from "@thepraggyverse/core";

export async function boardCommand(store = new FileRunStore()): Promise<string> {
  const runs = await store.listRuns();
  if (runs.length === 0) return "No Wayward runs found.";
  return runs.map((run) => `${run.id}\t${run.state}\t${run.workflowName}\t${run.mode}\t${run.updatedAt}`).join("\n");
}
