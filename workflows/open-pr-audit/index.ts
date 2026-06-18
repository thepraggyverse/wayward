import { spawn } from "node:child_process";
import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { objectSchema, runWithConcurrency } from "@thepraggyverse/workflow-runtime";
import { reportSchema, type ReviewFinding } from "../shared/review-schemas.js";

interface OpenPrAuditInput {
  repo: string;
  staleDays?: number;
  timeoutMs?: number;
}

export interface GhRunner {
  run(args: string[], options: { cwd: string; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;
}

export interface OpenPrAuditWorkflowDependencies {
  ghRunner?: GhRunner;
  now?: () => Date;
  staleDays?: number;
  timeoutMs?: number;
}

interface RawCommandArtifact {
  artifactId: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

interface NormalizedPullRequest {
  number: number;
  title: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  mergeStateStatus?: string;
  updatedAt?: string;
  reviewDecision?: string;
  latestReviews: NormalizedReview[];
  statusChecks: NormalizedCheck[];
  changedFiles: string[];
  rawArtifactIds: string[];
}

interface NormalizedReview {
  author: string;
  state: string;
  submittedAt?: string;
}

interface NormalizedCheck {
  name: string;
  status?: string;
  conclusion?: string;
}

interface PullRequestAudit {
  pr: NormalizedPullRequest;
  findings: ReviewFinding[];
  riskyFiles: string[];
  overlappingFiles: Array<{ path: string; prs: number[] }>;
  staleDays?: number;
  artifactId: string;
}

interface AuditOutput {
  repo: string;
  staleThresholdDays: number;
  listLimit: number;
  listMayBeTruncated: boolean;
  listWarning?: string;
  rawArtifactIds: string[];
  normalizedArtifactIds: string[];
  prs: PullRequestAudit[];
  overlaps: Array<{ path: string; prs: number[] }>;
}

const GH_PR_JSON_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "isDraft",
  "mergeStateStatus",
  "updatedAt",
  "reviewDecision",
  "latestReviews",
  "statusCheckRollup"
].join(",");

const DEFAULT_STALE_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
const OPEN_PR_LIST_LIMIT = 100;
const RISKY_FILE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "CI workflow", pattern: /^\.github\/workflows\// },
  { label: "package manifest", pattern: /(^|\/)package\.json$/ },
  { label: "dependency lockfile", pattern: /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/ },
  { label: "TypeScript project config", pattern: /(^|\/)tsconfig[^/]*\.json$/ },
  { label: "workflow implementation", pattern: /^workflows\// },
  { label: "core runtime package", pattern: /^packages\/(core|workflow-runtime)\// },
  { label: "CLI command surface", pattern: /^packages\/cli\// },
  { label: "automation script", pattern: /(^|\/)(scripts|bin)\// }
];

export function createOpenPrAuditWorkflow(dependencies: OpenPrAuditWorkflowDependencies = {}): WorkflowDefinition {
  return {
    name: "open-pr-audit",
    phases: [
      {
        id: "audit",
        kind: "fanout",
        inputSchema: objectSchema<OpenPrAuditInput>("OpenPrAuditInput", ["repo"], {
          repo: (value): value is string => typeof value === "string" && value.length > 0,
          staleDays: (value): value is number => value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0),
          timeoutMs: (value): value is number => value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0)
        }),
        async run(input: OpenPrAuditInput, context) {
          const gh = dependencies.ghRunner ?? new ProcessGhRunner();
          const timeoutMs = input.timeoutMs ?? dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
          const staleThresholdDays = input.staleDays ?? dependencies.staleDays ?? DEFAULT_STALE_DAYS;
          const list = await runGhJsonArray(context, gh, input.repo, ["pr", "list", "--state", "open", "--json", GH_PR_JSON_FIELDS, "--limit", String(OPEN_PR_LIST_LIMIT)], "gh-pr-list-raw", timeoutMs);
          const listMayBeTruncated = list.items.length >= OPEN_PR_LIST_LIMIT;
          const listWarning = firstPageWarning(list.items.length, OPEN_PR_LIST_LIMIT);
          const prs = await runWithConcurrency(list.items, 4, async (rawPr) => collectPullRequest(context, gh, input.repo, rawPr, timeoutMs));
          const overlaps = findOverlaps(prs);
          const now = dependencies.now?.() ?? new Date();
          const audits = await Promise.all(prs.map(async (pr) => {
            const findings = auditPullRequest(pr, overlaps, now, staleThresholdDays);
            const riskyFiles = findRiskyFiles(pr.changedFiles);
            const overlappingFiles = overlaps.filter((overlap) => overlap.prs.includes(pr.number));
            const artifact = await context.store.writeArtifact(
              context.runId,
              { id: `pr-${pr.number}-audit`, kind: "open-pr-audit-normalized-json" },
              `${JSON.stringify({ pr, findings, riskyFiles, overlappingFiles }, null, 2)}\n`
            );
            return { pr, findings, riskyFiles, overlappingFiles, staleDays: daysSince(pr.updatedAt, now), artifactId: artifact.id };
          }));
          const normalized = await context.store.writeArtifact(
            context.runId,
            { id: "open-pr-audit-normalized", kind: "open-pr-audit-normalized-json" },
            `${JSON.stringify({ repo: input.repo, staleThresholdDays, listLimit: OPEN_PR_LIST_LIMIT, listMayBeTruncated, listWarning, prs: audits, overlaps }, null, 2)}\n`
          );
          return {
            repo: input.repo,
            staleThresholdDays,
            listLimit: OPEN_PR_LIST_LIMIT,
            listMayBeTruncated,
            listWarning,
            rawArtifactIds: [list.artifactId, ...prs.flatMap((pr) => pr.rawArtifactIds)],
            normalizedArtifactIds: [normalized.id, ...audits.map((audit) => audit.artifactId)],
            prs: audits,
            overlaps
          };
        }
      },
      {
        id: "rule",
        kind: "reduce",
        async run(input: AuditOutput) {
          return {
            ...input,
            dispositions: input.prs.map((audit) => ({
              pr: audit.pr.number,
              action: "inspect-only",
              severity: highestSeverity(audit.findings),
              findingCount: audit.findings.length
            }))
          };
        }
      },
      {
        id: "verify",
        kind: "verify",
        async run(input: AuditOutput & { dispositions: Array<{ pr: number; action: string }> }) {
          return {
            ...input,
            verified: input.prs.every((audit) => audit.pr.rawArtifactIds.length >= 2 && audit.artifactId),
            externalMutations: false
          };
        }
      },
      {
        id: "synthesize",
        kind: "synthesize",
        outputSchema: reportSchema,
        async run(input: AuditOutput & { verified: boolean; externalMutations: boolean }, context) {
          const findings = flattenAuditFindings(input);
          const riskSignalCount = input.prs.reduce((count, audit) => count + audit.findings.length, 0) + (input.listMayBeTruncated ? 1 : 0);
          const summary = [
            `Audited ${input.prs.length} open pull request${input.prs.length === 1 ? "" : "s"} in ${input.repo} using read-only GitHub CLI commands.`,
            input.listWarning,
            riskSignalCount
              ? `Found ${riskSignalCount} risk signal${riskSignalCount === 1 ? "" : "s"} across stale state, changed-file risk, overlapping scopes, checks, reviews, and mergeability.`
              : "No PR risk signals were found across stale state, changed-file risk, overlapping scopes, checks, reviews, and mergeability.",
            input.verified && !input.externalMutations ? "Raw gh artifacts and normalized audit artifacts were persisted before the approval gate." : "Verification found missing audit evidence."
          ].filter(Boolean).join(" ");
          await context.store.writeArtifact(
            context.runId,
            { id: "open-pr-audit-synthesis", kind: "open-pr-audit-synthesis-json" },
            `${JSON.stringify({
              repo: input.repo,
              listLimit: input.listLimit,
              listMayBeTruncated: input.listMayBeTruncated,
              listWarning: input.listWarning,
              summary,
              findings,
              rawArtifactIds: input.rawArtifactIds,
              normalizedArtifactIds: input.normalizedArtifactIds,
              overlaps: input.overlaps
            }, null, 2)}\n`
          );
          return { summary, findings };
        }
      },
      {
        id: "external-action-gate",
        kind: "gate",
        async run(input) {
          return input;
        }
      }
    ]
  };
}

class ProcessGhRunner implements GhRunner {
  async run(args: string[], options: { cwd: string; timeoutMs?: number }) {
    return new Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>((resolve, reject) => {
      const child = spawn("gh", args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let didTimeout = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            didTimeout = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
          }, options.timeoutMs)
        : undefined;
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve({ code: didTimeout ? 124 : code ?? 1, stdout, stderr, timedOut: didTimeout });
      });
    });
  }
}

async function collectPullRequest(
  context: { runId: string; store: { writeArtifact: (runId: string, artifact: { id: string; kind: string }, content: string) => Promise<{ id: string }> } },
  gh: GhRunner,
  repo: string,
  listPr: unknown,
  timeoutMs: number
): Promise<NormalizedPullRequest> {
  const number = readNumber(listPr, "number");
  if (!number) throw new Error(`gh pr list returned a pull request without a number: ${JSON.stringify(listPr)}`);
  const view = await runGhJsonObject(context, gh, repo, ["pr", "view", String(number), "--json", GH_PR_JSON_FIELDS], `gh-pr-${number}-view-raw`, timeoutMs);
  const diff = await runGhText(context, gh, repo, ["pr", "diff", String(number), "--name-only"], `gh-pr-${number}-diff-name-only-raw`, timeoutMs);
  return normalizePullRequest({ ...(isRecord(listPr) ? listPr : {}), ...view }, diff.stdout, [view.artifactId, diff.artifactId]);
}

async function runGhJsonArray(
  context: { runId: string; store: { writeArtifact: (runId: string, artifact: { id: string; kind: string }, content: string) => Promise<{ id: string }> } },
  gh: GhRunner,
  repo: string,
  args: string[],
  artifactId: string,
  timeoutMs: number
): Promise<{ items: unknown[]; artifactId: string }> {
  const raw = await runGhText(context, gh, repo, args, artifactId, timeoutMs);
  const parsed = parseGhJson(raw);
  if (!Array.isArray(parsed)) throw new Error(`gh ${args.join(" ")} did not return a JSON array`);
  return { items: parsed, artifactId: raw.artifactId };
}

async function runGhJsonObject(
  context: { runId: string; store: { writeArtifact: (runId: string, artifact: { id: string; kind: string }, content: string) => Promise<{ id: string }> } },
  gh: GhRunner,
  repo: string,
  args: string[],
  artifactId: string,
  timeoutMs: number
): Promise<Record<string, unknown> & { artifactId: string }> {
  const raw = await runGhText(context, gh, repo, args, artifactId, timeoutMs);
  const parsed = parseGhJson(raw);
  if (!isRecord(parsed)) throw new Error(`gh ${args.join(" ")} did not return a JSON object`);
  return { ...parsed, artifactId: raw.artifactId };
}

async function runGhText(
  context: { runId: string; store: { writeArtifact: (runId: string, artifact: { id: string; kind: string }, content: string) => Promise<{ id: string }> } },
  gh: GhRunner,
  repo: string,
  args: string[],
  artifactId: string,
  timeoutMs: number
): Promise<RawCommandArtifact> {
  const result = await gh.run(args, { cwd: repo, timeoutMs });
  const payload = {
    command: "gh",
    args,
    cwd: repo,
    exitCode: result.code,
    timedOut: result.timedOut ?? false,
    stdout: result.stdout,
    stderr: result.stderr
  };
  const artifact = await context.store.writeArtifact(context.runId, { id: artifactId, kind: "gh-raw" }, `${JSON.stringify(payload, null, 2)}\n`);
  if (result.code !== 0) {
    const suffix = result.stderr.trim() ? `: ${result.stderr.trim()}` : "";
    throw new Error(`gh ${args.join(" ")} failed with exit ${result.code}${suffix}`);
  }
  return { artifactId: artifact.id, args, exitCode: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
}

function parseGhJson(raw: RawCommandArtifact): unknown {
  try {
    return JSON.parse(raw.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${raw.artifactId} as JSON: ${message}`);
  }
}

function normalizePullRequest(raw: Record<string, unknown>, diffNameOnly: string, rawArtifactIds: string[]): NormalizedPullRequest {
  return {
    number: readNumber(raw, "number") ?? 0,
    title: readString(raw, "title") ?? "(untitled pull request)",
    author: readAuthor(raw.author),
    headBranch: readString(raw, "headRefName") ?? "(unknown head)",
    baseBranch: readString(raw, "baseRefName") ?? "(unknown base)",
    isDraft: raw.isDraft === true,
    mergeStateStatus: readString(raw, "mergeStateStatus"),
    updatedAt: readString(raw, "updatedAt"),
    reviewDecision: readString(raw, "reviewDecision"),
    latestReviews: normalizeReviews(raw.latestReviews),
    statusChecks: normalizeChecks(raw.statusCheckRollup),
    changedFiles: diffNameOnly.split("\n").map((line) => line.trim()).filter(Boolean),
    rawArtifactIds
  };
}

function auditPullRequest(pr: NormalizedPullRequest, overlaps: Array<{ path: string; prs: number[] }>, now: Date, staleThresholdDays: number): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const riskyFiles = findRiskyFiles(pr.changedFiles);
  if (riskyFiles.length) {
    findings.push({
      title: `PR #${pr.number} changes risky files`,
      severity: riskyFiles.some((path) => path.startsWith(".github/workflows/") || path.includes("lock")) ? "high" : "medium",
      evidence: `Changed risky files: ${riskyFiles.join(", ")}. Raw artifacts: ${artifactEvidence(pr.rawArtifactIds)}.`
    });
  }
  const overlappingFiles = overlaps.filter((overlap) => overlap.prs.includes(pr.number));
  if (overlappingFiles.length) {
    findings.push({
      title: `PR #${pr.number} overlaps with other open PRs`,
      severity: "medium",
      evidence: overlappingFiles.map((overlap) => `${overlap.path} in PRs ${overlap.prs.map((number) => `#${number}`).join(", ")}`).join("; ")
    });
  }
  const stale = daysSince(pr.updatedAt, now);
  if (stale !== undefined && stale >= staleThresholdDays) {
    findings.push({
      title: `PR #${pr.number} is stale`,
      severity: stale >= staleThresholdDays * 2 ? "high" : "medium",
      evidence: `Last updated ${stale} days ago at ${pr.updatedAt}; threshold is ${staleThresholdDays} days.`
    });
  }
  findings.push(...auditChecks(pr));
  findings.push(...auditReviews(pr));
  const mergeFinding = auditMergeability(pr);
  if (mergeFinding) findings.push(mergeFinding);
  if (pr.isDraft) {
    findings.push({
      title: `PR #${pr.number} is still draft`,
      severity: "low",
      evidence: `Draft PR ${pr.headBranch} -> ${pr.baseBranch} should stay gated until marked ready for review.`
    });
  }
  return findings;
}

function auditChecks(pr: NormalizedPullRequest): ReviewFinding[] {
  if (pr.statusChecks.length === 0) {
    return [{
      title: `PR #${pr.number} has no checks reported`,
      severity: "medium",
      evidence: `GitHub statusCheckRollup returned no checks. Raw artifacts: ${artifactEvidence(pr.rawArtifactIds)}.`
    }];
  }
  const failing = pr.statusChecks.filter((check) => isFailingCheck(check));
  if (failing.length) {
    return [{
      title: `PR #${pr.number} has failing checks`,
      severity: "high",
      evidence: failing.map((check) => `${check.name} status=${check.status ?? "unknown"} conclusion=${check.conclusion ?? "unknown"}`).join("; ")
    }];
  }
  const pending = pr.statusChecks.filter((check) => isPendingCheck(check));
  if (pending.length) {
    return [{
      title: `PR #${pr.number} has pending checks`,
      severity: "medium",
      evidence: pending.map((check) => `${check.name} status=${check.status ?? "unknown"} conclusion=${check.conclusion ?? "unknown"}`).join("; ")
    }];
  }
  return [];
}

function auditReviews(pr: NormalizedPullRequest): ReviewFinding[] {
  if (pr.reviewDecision === "APPROVED") return [];
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return [{
      title: `PR #${pr.number} has changes requested`,
      severity: "high",
      evidence: reviewEvidence(pr)
    }];
  }
  return [{
    title: `PR #${pr.number} lacks recorded approval`,
    severity: "medium",
    evidence: reviewEvidence(pr)
  }];
}

function auditMergeability(pr: NormalizedPullRequest): ReviewFinding | undefined {
  const status = pr.mergeStateStatus;
  if (!status || status === "CLEAN" || status === "HAS_HOOKS") return undefined;
  const high = status === "DIRTY" || status === "BLOCKED";
  return {
    title: `PR #${pr.number} mergeability is ${status}`,
    severity: high ? "high" : "medium",
    evidence: `mergeStateStatus=${status} for ${pr.headBranch} -> ${pr.baseBranch}.`
  };
}

function flattenAuditFindings(input: AuditOutput): ReviewFinding[] {
  const findings = [
    ...truncationFindings(input),
    ...input.prs.flatMap((audit) => audit.findings.map((finding) => ({
      ...finding,
      evidence: `${finding.evidence} (artifact:${audit.artifactId})`
    })))
  ];
  if (findings.length === 0) {
    return [{
      title: "No open PR audit risks found",
      severity: "low",
      evidence: `Audited ${input.prs.length} PRs. Normalized artifacts: ${artifactEvidence(input.normalizedArtifactIds)}.`
    }];
  }
  return findings;
}

function truncationFindings(input: AuditOutput): ReviewFinding[] {
  if (!input.listMayBeTruncated) return [];
  return [{
    title: `Open PR audit reached first ${input.listLimit} PRs`,
    severity: "medium",
    evidence: `${input.listWarning ?? firstPageWarning(input.prs.length, input.listLimit)} Raw artifacts: ${artifactEvidence(input.rawArtifactIds.slice(0, 1))}.`
  }];
}

function firstPageWarning(count: number, limit: number): string | undefined {
  if (count < limit) return undefined;
  return `The audit reached the gh pr list limit of ${limit}; additional open PRs may exist beyond this audit window.`;
}

function findRiskyFiles(paths: string[]): string[] {
  return paths.filter((path) => RISKY_FILE_PATTERNS.some(({ pattern }) => pattern.test(path)));
}

function findOverlaps(prs: NormalizedPullRequest[]): Array<{ path: string; prs: number[] }> {
  const byPath = new Map<string, number[]>();
  for (const pr of prs) {
    for (const path of new Set(pr.changedFiles)) {
      byPath.set(path, [...(byPath.get(path) ?? []), pr.number]);
    }
  }
  return [...byPath.entries()]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([path, numbers]) => ({ path, prs: numbers.sort((a, b) => a - b) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeReviews(value: unknown): NormalizedReview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((review) => {
    if (!isRecord(review)) return [];
    return [{
      author: readAuthor(review.author),
      state: readString(review, "state") ?? "UNKNOWN",
      submittedAt: readString(review, "submittedAt")
    }];
  });
}

function normalizeChecks(value: unknown): NormalizedCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((check) => {
    if (!isRecord(check)) return [];
    return [{
      name: readString(check, "name") ?? readString(check, "workflowName") ?? readString(check, "context") ?? "unnamed check",
      status: readString(check, "status") ?? readString(check, "state"),
      conclusion: readString(check, "conclusion")
    }];
  });
}

function readAuthor(value: unknown): string {
  if (!isRecord(value)) return "(unknown author)";
  return readString(value, "login") ?? readString(value, "name") ?? "(unknown author)";
}

function reviewEvidence(pr: NormalizedPullRequest): string {
  const reviews = pr.latestReviews.length
    ? pr.latestReviews.map((review) => `${review.author}:${review.state}${review.submittedAt ? ` at ${review.submittedAt}` : ""}`).join("; ")
    : "no latestReviews returned";
  return `reviewDecision=${pr.reviewDecision ?? "unavailable"}; ${reviews}. Raw artifacts: ${artifactEvidence(pr.rawArtifactIds)}.`;
}

function isFailingCheck(check: NormalizedCheck): boolean {
  return ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes((check.conclusion ?? "").toUpperCase())
    || ["FAILURE", "ERROR", "FAILED", "CANCELLED"].includes((check.status ?? "").toUpperCase());
}

function isPendingCheck(check: NormalizedCheck): boolean {
  const status = (check.status ?? "").toUpperCase();
  const conclusion = (check.conclusion ?? "").toUpperCase();
  return !conclusion && ["QUEUED", "REQUESTED", "WAITING", "PENDING", "IN_PROGRESS", "EXPECTED"].includes(status);
}

function daysSince(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

function highestSeverity(findings: ReviewFinding[]): ReviewFinding["severity"] {
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  return "low";
}

function artifactEvidence(ids: string[]): string {
  return ids.map((id) => `artifact:${id}`).join(", ") || "none";
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
