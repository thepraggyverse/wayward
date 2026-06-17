import type { FileRunStore } from "@thepraggyverse/core";
import type { Schema } from "./schemas.js";

export type PhaseKind = "fanout" | "reduce" | "verify" | "synthesize" | "gate";
export type PhasePolicy = "required" | "optional";

export interface PhaseDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  kind: PhaseKind;
  policy?: PhasePolicy;
  inputSchema?: Schema<TInput>;
  outputSchema?: Schema<TOutput>;
  run(input: TInput, context: PhaseContext): Promise<TOutput>;
}

export interface PhaseContext {
  runId: string;
  store: FileRunStore;
  emitArtifact(kind: string, content: string): Promise<string>;
}

export interface PhaseResult {
  phaseId: string;
  kind: PhaseKind;
  state: "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
}
