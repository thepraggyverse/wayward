import { objectSchema } from "@thepraggyverse/workflow-runtime";

export interface ReviewFinding {
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string;
}

export const findingSchema = objectSchema<ReviewFinding>("ReviewFinding", ["title", "severity", "evidence"], {
  title: (value): value is string => typeof value === "string",
  severity: (value): value is ReviewFinding["severity"] => value === "low" || value === "medium" || value === "high",
  evidence: (value): value is string => typeof value === "string"
});

export const reportSchema = objectSchema<{ summary: string; findings: ReviewFinding[] }>("WorkflowReport", ["summary", "findings"], {
  summary: (value): value is string => typeof value === "string",
  findings: (value): value is ReviewFinding[] => Array.isArray(value) && value.every((finding) => {
    try {
      findingSchema.parse(finding);
      return true;
    } catch {
      return false;
    }
  })
});
