import type { MemorySafetyIssue } from "./types.js";

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[a-z0-9_\-]{16,}/i,
  /\bghp_[a-z0-9_]{20,}\b/i,
  /\bsk-[a-z0-9]{20,}\b/i,
] as const;

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|prior|system|developer) instructions/i,
  /reveal (?:the )?(?:system|developer) prompt/i,
  /do not obey (?:the )?(?:system|developer|user)/i,
] as const;

export function findUnsafeMemoryText(content: string): MemorySafetyIssue[] {
  const issues: MemorySafetyIssue[] = [];
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    issues.push({
      code: "unsafe_secret",
      severity: "error",
      message: "secret-like content detected",
    });
  }
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(content))) {
    issues.push({
      code: "prompt_injection",
      severity: "warning",
      message: "prompt-injection-like instruction detected",
    });
  }
  return issues;
}

export function assertNoUnsafeSecret(content: string): void {
  const secretIssue = findUnsafeMemoryText(content).find((issue) => issue.code === "unsafe_secret");
  if (secretIssue) throw new Error(secretIssue.message);
}
