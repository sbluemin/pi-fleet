export const LAUNCH_REMINDER_TEXT = [
  "The carrier job has been accepted for background execution.",
  "A <system-reminder> follow-up push with [carrier:result] will arrive automatically when the job reaches a terminal state.",
  "Do not poll, wait-check, or call carrier_jobs merely to see whether the job is done.",
  "Continue with independent work if any remains; otherwise stop tool use and wait passively for the [carrier:result] follow-up push.",
  "Use carrier_jobs only when the push is missing or an explicit lookup is required.",
].join(" ");

export const CARRIER_RESULT_PUSH_PREFIX = "[carrier:result]";

export function formatLaunchResponseText(response: unknown, accepted: boolean): string {
  const payload = JSON.stringify(response);
  if (!accepted) return payload;
  return wrapSystemReminder(LAUNCH_REMINDER_TEXT) + "\n" + payload;
}

export function wrapSystemReminder(text: string): string {
  return `<system-reminder>\n${text}\n</system-reminder>`;
}
