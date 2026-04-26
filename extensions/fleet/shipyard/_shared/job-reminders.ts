interface SystemReminderAttributes {
  [key: string]: string;
}

export const JOB_LAUNCH_NOTICE = [
  "Job accepted; result arrives as <system-reminder source=\"carrier-completion\"> with [carrier:result] push.",
  "DO NOT poll carrier_jobs.",
].join(" ");

export const CARRIER_RESULT_PUSH_PREFIX = "[carrier:result]";

export function formatLaunchResponseText(response: unknown, accepted: boolean): string {
  const payload = JSON.stringify(response);
  if (!accepted) return payload;
  return JOB_LAUNCH_NOTICE + "\n" + payload;
}

export function wrapSystemReminder(text: string, attrs?: SystemReminderAttributes): string {
  const renderedAttrs = renderSystemReminderAttributes(attrs);
  return `<system-reminder${renderedAttrs}>\n${text}\n</system-reminder>`;
}

function renderSystemReminderAttributes(attrs?: SystemReminderAttributes): string {
  if (!attrs) return "";
  const pairs = Object.entries(attrs);
  if (pairs.length === 0) return "";
  return pairs.map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`).join("");
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
