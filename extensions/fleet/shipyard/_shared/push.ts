import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getDeliverAs } from "../../push-mode-settings.js";
import type { CompletionPushItem } from "./job-types.js";
import { CARRIER_RESULT_PUSH_PREFIX, wrapSystemReminder } from "./job-reminders.js";
import { CARRIER_RESULT_CUSTOM_TYPE, type CarrierResultMessageDetails } from "./push-renderer.js";

interface PushState {
  pending: CompletionPushItem[];
  timer: ReturnType<typeof setTimeout> | null;
}

const PUSH_STATE_KEY = "__pi_fleet_job_completion_push__";
const PUSH_BATCH_MS = 2_000;

export function enqueueCarrierCompletionPush(pi: ExtensionAPI, item: CompletionPushItem): void {
  const state = getPushState();
  state.pending.push({
    jobId: item.jobId,
    summary: sanitizePushSummary(item.summary),
  });
  if (state.timer) return;
  state.timer = setTimeout(() => flushCarrierCompletionPush(pi), PUSH_BATCH_MS);
}

export function flushCarrierCompletionPush(pi: ExtensionAPI): void {
  const state = getPushState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const pending = state.pending.splice(0);
  if (pending.length === 0) return;
  const lines = pending.map((item) => `- ${item.jobId}: ${item.summary}`);
  const content = wrapSystemReminder(`${CARRIER_RESULT_PUSH_PREFIX}\n${lines.join("\n")}`);
  const details: CarrierResultMessageDetails = {
    jobIds: pending.map((item) => item.jobId),
    summaries: pending.map((item) => item.summary),
  };
  pi.sendMessage({
    customType: CARRIER_RESULT_CUSTOM_TYPE,
    content,
    display: false,
    details,
  }, {
    triggerTurn: true,
    deliverAs: getDeliverAs(),
  });
}

export function resetCarrierCompletionPushForTest(): void {
  const state = getPushState();
  if (state.timer) clearTimeout(state.timer);
  state.pending = [];
  state.timer = null;
}

function sanitizePushSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim().slice(0, 500);
}

function getPushState(): PushState {
  const root = globalThis as Record<string, unknown>;
  const existing = root[PUSH_STATE_KEY] as PushState | undefined;
  if (existing) return existing;
  const state: PushState = { pending: [], timer: null };
  root[PUSH_STATE_KEY] = state;
  return state;
}
