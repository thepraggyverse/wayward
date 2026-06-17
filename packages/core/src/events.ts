export type WaywardEventType =
  | "run.created"
  | "run.state_changed"
  | "phase.started"
  | "phase.completed"
  | "job.event"
  | "artifact.written"
  | "approval.requested"
  | "approval.decided"
  | "checkpoint.created"
  | "report.written";

export interface WaywardEvent {
  id: string;
  runId: string;
  type: WaywardEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export function createEvent(runId: string, type: WaywardEventType, payload: Record<string, unknown> = {}): WaywardEvent {
  return {
    id: createId("event"),
    runId,
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}
import { createId } from "./ids.js";
