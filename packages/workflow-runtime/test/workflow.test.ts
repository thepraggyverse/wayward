import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import { runWithConcurrency, WorkflowRuntime, objectSchema } from "../src/index.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("WorkflowRuntime", () => {
  it("validates outputs before downstream phases consume them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-workflow-"));
    tempDirs.push(dir);
    const runtime = new WorkflowRuntime(new FileRunStore(join(dir, "runs")));
    const result = await runtime.run({
      name: "invalid",
      phases: [
        {
          id: "bad",
          kind: "verify",
          outputSchema: objectSchema<{ value: string }>("NeedsValue", ["value"]),
          async run() {
            return {};
          }
        }
      ]
    });

    expect(result.results[0]?.state).toBe("failed");
  });

  it("honors max concurrency helpers", async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3, 4], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return true;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("stops after required phase failures and skips optional failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-workflow-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const runtime = new WorkflowRuntime(store);
    let requiredSentinelRan = false;

    const required = await runtime.run({
      name: "required-failure",
      phases: [
        { id: "fail", kind: "verify", async run() { throw new Error("nope"); } },
        { id: "sentinel", kind: "verify", async run() { requiredSentinelRan = true; return {}; } }
      ]
    });

    expect(required.results).toHaveLength(1);
    expect(requiredSentinelRan).toBe(false);
    expect((await store.getRun(required.runId)).state).toBe("failed");

    const optional = await runtime.run({
      name: "optional-failure",
      phases: [
        { id: "optional", kind: "verify", policy: "optional", async run() { throw new Error("skip me"); } },
        { id: "next", kind: "verify", async run() { return { ok: true }; } }
      ]
    });

    expect(optional.results.map((result) => result.state)).toEqual(["skipped", "completed"]);
    expect((await store.getRun(optional.runId)).state).toBe("completed");
  });
});
