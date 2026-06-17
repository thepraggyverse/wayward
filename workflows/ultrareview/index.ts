import { readFile } from "node:fs/promises";
import type { FileRunStore, JobState } from "@thepraggyverse/core";
import { CodexAdapter } from "@thepraggyverse/codex-adapter";
import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { objectSchema, runWithConcurrency } from "@thepraggyverse/workflow-runtime";
import { reportSchema, type ReviewFinding } from "../shared/review-schemas.js";

interface UltrareviewInput {
  repo: string;
  timeoutMs?: number;
}

interface UltrareviewAdapter {
  startExecJob(input: { runId: string; jobId: string; cwd: string; prompt: string; timeoutMs?: number; sandbox?: "read-only" | "workspace-write" | "danger-full-access" }): Promise<JobState>;
}

export interface UltrareviewWorkflowDependencies {
  adapterFactory?: (store: FileRunStore) => UltrareviewAdapter;
  timeoutMs?: number;
}

interface ReviewerDefinition {
  id: string;
  title: string;
  concern: string;
  instructions: string;
}

interface ReviewerResult {
  reviewerId: string;
  title: string;
  concern: string;
  jobId: string;
  state: JobState;
  summary: string;
  findings: ReviewFinding[];
  artifactIds: string[];
  rawArtifactId?: string;
  summaryArtifactId?: string;
  error?: string;
}

interface SpecialistReviewOutput {
  repo: string;
  reviewers: ReviewerResult[];
}

const REVIEWERS: ReviewerDefinition[] = [
  {
    id: "correctness",
    title: "Correctness reviewer",
    concern: "correctness",
    instructions: "Find logic bugs, broken edge cases, behavioral regressions, and places where the implementation may not satisfy the requested contract."
  },
  {
    id: "security",
    title: "Security reviewer",
    concern: "security",
    instructions: "Find security, privacy, secret-handling, injection, unsafe filesystem/process, and trust-boundary issues."
  },
  {
    id: "tests",
    title: "Test reviewer",
    concern: "tests",
    instructions: "Find missing, weak, brittle, or misleading tests and identify the smallest useful verification additions."
  },
  {
    id: "maintainability",
    title: "Architecture/maintainability reviewer",
    concern: "architecture/maintainability",
    instructions: "Find design, API, state-management, duplication, and long-term maintainability risks."
  },
  {
    id: "adversarial-verifier",
    title: "Adversarial verifier",
    concern: "adversarial verification",
    instructions: "Actively try to disprove the other reviewers' likely conclusions. Look for false confidence, untested assumptions, and ways the workflow can silently report success."
  }
];

export function createUltrareviewWorkflow(dependencies: UltrareviewWorkflowDependencies = {}): WorkflowDefinition {
  return {
    name: "ultrareview",
    phases: [
      {
        id: "specialist-review",
        kind: "fanout",
        inputSchema: objectSchema<UltrareviewInput>("UltrareviewInput", ["repo"], {
          repo: (value): value is string => typeof value === "string" && value.length > 0,
          timeoutMs: (value): value is number => value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0)
        }),
        async run(input: UltrareviewInput, context) {
          const adapter = dependencies.adapterFactory?.(context.store) ?? new CodexAdapter(context.store);
          const timeoutMs = input.timeoutMs ?? dependencies.timeoutMs;
          const reviewers = await runWithConcurrency(REVIEWERS, 2, async (reviewer) => runReviewer({ adapter, context, input, reviewer, timeoutMs }));
          return { repo: input.repo, reviewers };
        }
      },
      {
        id: "synthesize",
        kind: "synthesize",
        outputSchema: reportSchema,
        async run(input: SpecialistReviewOutput, context) {
          const completed = input.reviewers.filter((reviewer) => reviewer.state === "completed");
          const failed = input.reviewers.filter((reviewer) => reviewer.state !== "completed");
          const findings = flattenFindings(input.reviewers);
          const sourceArtifactIds = input.reviewers.flatMap((reviewer) => reviewer.artifactIds);
          const summary = [
            `Ultrareview ran ${input.reviewers.length} Codex specialist reviewers against ${input.repo}.`,
            `${completed.length} completed; ${failed.length} failed or timed out.`,
            findings.length ? `${findings.length} synthesized findings or reviewer notes are linked to artifacts.` : "No reviewer findings were reported."
          ].join(" ");
          await context.store.writeArtifact(
            context.runId,
            { id: "ultrareview-synthesis", kind: "ultrareview-synthesis-json" },
            `${JSON.stringify({ repo: input.repo, summary, reviewers: input.reviewers, findings, sourceArtifactIds }, null, 2)}\n`
          );
          return { summary, findings };
        }
      }
    ]
  };
}

async function runReviewer(input: {
  adapter: UltrareviewAdapter;
  context: { runId: string; store: FileRunStore };
  input: UltrareviewInput;
  reviewer: ReviewerDefinition;
  timeoutMs?: number;
}): Promise<ReviewerResult> {
  const jobId = `reviewer-${input.reviewer.id}`;
  let state: JobState = "failed";
  let error: string | undefined;

  try {
    state = await input.adapter.startExecJob({
      runId: input.context.runId,
      jobId,
      cwd: input.input.repo,
      prompt: buildReviewerPrompt(input.reviewer),
      timeoutMs: input.timeoutMs,
      sandbox: "read-only"
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    await input.context.store.upsertJob(input.context.runId, {
      id: jobId,
      adapter: "codex",
      state: "failed",
      error,
      finishedAt: new Date().toISOString()
    });
  }

  const run = await input.context.store.getRun(input.context.runId);
  const job = run.jobs.find((candidate) => candidate.id === jobId);
  const rawArtifact = run.artifacts.find((artifact) => artifact.sourceJobId === jobId && artifact.kind === "codex-jsonl");
  error ??= job?.error;

  const normalized = rawArtifact
    ? await normalizeReviewerOutput(rawArtifact.path)
    : { summary: "Reviewer did not produce a raw artifact.", findings: [] };
  const summary = state === "completed"
    ? normalized.summary
    : [normalized.summary, error ? `Job ${state}: ${error}` : `Job ended with state ${state}.`].filter(Boolean).join(" ");

  const summaryArtifact = await input.context.store.writeArtifact(
    input.context.runId,
    { id: `${jobId}-summary`, kind: "ultrareview-reviewer-summary-json", sourceJobId: jobId },
    `${JSON.stringify({
      reviewerId: input.reviewer.id,
      title: input.reviewer.title,
      concern: input.reviewer.concern,
      jobId,
      state,
      summary,
      findings: normalized.findings,
      rawArtifactId: rawArtifact?.id,
      error
    }, null, 2)}\n`
  );

  return {
    reviewerId: input.reviewer.id,
    title: input.reviewer.title,
    concern: input.reviewer.concern,
    jobId,
    state,
    summary,
    findings: normalized.findings.map((finding) => ({
      ...finding,
      title: `[${input.reviewer.title}] ${finding.title}`,
      evidence: artifactEvidence(finding.evidence, [rawArtifact?.id, summaryArtifact.id])
    })),
    artifactIds: [rawArtifact?.id, summaryArtifact.id].filter((id): id is string => Boolean(id)),
    rawArtifactId: rawArtifact?.id,
    summaryArtifactId: summaryArtifact.id,
    error
  };
}

function buildReviewerPrompt(reviewer: ReviewerDefinition): string {
  return [
    `You are the Wayward ${reviewer.title}.`,
    "Review the current repository in read-only mode. Do not edit files, create branches, commit, install dependencies, or perform external actions.",
    reviewer.instructions,
    "Return only a JSON object with this shape:",
    '{"summary":"one short paragraph","findings":[{"title":"specific issue","severity":"low|medium|high","evidence":"file paths, commands, artifacts, or concrete observations"}]}',
    "If there are no findings, return an empty findings array and explain the residual risk in summary."
  ].join("\n\n");
}

async function normalizeReviewerOutput(path: string): Promise<{ summary: string; findings: ReviewFinding[] }> {
  const raw = await readFile(path, "utf8");
  const candidates = extractTextCandidates(raw);
  for (const candidate of [...candidates].reverse()) {
    const parsed = parseReviewerJson(candidate);
    if (parsed) return parsed;
  }
  const text = candidates.at(-1) ?? raw.trim();
  return {
    summary: text.trim() || "Reviewer completed without a parseable final message.",
    findings: []
  };
}

function extractTextCandidates(raw: string): string[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return collectText(JSON.parse(line)).join("\n").trim();
      } catch {
        return line.trim();
      }
    })
    .filter(Boolean);
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectText);
  const record = value as Record<string, unknown>;
  const ownText = Object.entries(record)
    .filter(([key, nested]) => (key === "text" || key === "content") && typeof nested === "string")
    .map(([, nested]) => nested as string);
  return [...ownText, ...Object.values(record).flatMap(collectText)];
}

function parseReviewerJson(text: string): { summary: string; findings: ReviewFinding[] } | undefined {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as { summary?: unknown; findings?: unknown };
      if (typeof parsed.summary !== "string") continue;
      const findings = Array.isArray(parsed.findings) ? parsed.findings.flatMap(normalizeFinding) : [];
      return { summary: parsed.summary, findings };
    } catch {
      continue;
    }
  }
  return undefined;
}

function jsonCandidates(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]?.trim()).filter((candidate): candidate is string => Boolean(candidate));
  const trimmed = text.trim();
  const objectSlice = trimmed.includes("{") && trimmed.includes("}") ? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1) : "";
  return [...fenced, trimmed, objectSlice].filter(Boolean);
}

function normalizeFinding(value: unknown): ReviewFinding[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title : "Reviewer finding";
  const severity = record.severity === "high" || record.severity === "medium" || record.severity === "low" ? record.severity : "medium";
  const evidence = typeof record.evidence === "string" && record.evidence.trim() ? record.evidence : "No reviewer evidence provided.";
  return [{ title, severity, evidence }];
}

function flattenFindings(reviewers: ReviewerResult[]): ReviewFinding[] {
  const reviewerFindings = reviewers.flatMap((reviewer) => reviewer.findings);
  const unsuccessfulNotes = reviewers
    .filter((reviewer) => reviewer.state !== "completed")
    .map((reviewer): ReviewFinding => ({
      title: `[${reviewer.title}] reviewer ${reviewer.state}`,
      severity: reviewer.state === "timed_out" ? "medium" : "low",
      evidence: artifactEvidence(reviewer.error ?? reviewer.summary, reviewer.artifactIds)
    }));
  return [...reviewerFindings, ...unsuccessfulNotes];
}

function artifactEvidence(evidence: string, artifactIds: Array<string | undefined>): string {
  const refs = artifactIds.filter((id): id is string => Boolean(id)).map((id) => `artifact:${id}`);
  return refs.length ? `${evidence} (${refs.join(", ")})` : evidence;
}
