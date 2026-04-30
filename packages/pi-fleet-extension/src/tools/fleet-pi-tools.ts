import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { ANSI_RESET, SORTIE_SUMMARY_COLOR, SQUADRON_BADGE_COLOR, TASKFORCE_BADGE_COLOR } from "@sbluemin/fleet-core/constants";
import { configureJobSummaryCache, detachJobArchive } from "@sbluemin/fleet-core/job";
import {
  createFleetToolRegistry,
  type AgentToolCtx,
  type AgentToolSpec,
  type FleetToolRegistryPorts,
} from "@sbluemin/fleet-core";
import type { FleetHostPorts } from "@sbluemin/fleet-core";
import type { FleetLogPort } from "@sbluemin/fleet-core";

import { CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer } from "./carrier-result-renderer.js";
import { enqueueCarrierCompletionPush } from "../session/carrier-completion.js";
import { renderCarrierJobsCall, renderCarrierJobsResult } from "./carrier_jobs/jobs.js";
import type { CarrierJobsToolResult } from "./carrier_jobs/render.js";
import { getLogAPI } from "@sbluemin/fleet-core/services/log";
import { renderRequestPreview } from "./request-preview.js";
import { runAgentRequestBackground } from "../session/fleet/operation-runner.js";

interface PiRenderContext {
  readonly args?: unknown;
  readonly lastComponent?: unknown;
}

interface PreviewEntry {
  label: string;
  text: string;
}

const fleetLogPort: FleetLogPort = (level, message, details) => {
  getLogAPI().log(level, "fleet-tool", message, details as Parameters<ReturnType<typeof getLogAPI>["log"]>[3]);
};

const noopHostPorts: FleetHostPorts = {
  sendCarrierResultPush() {},
  notify(level, message) {
    getLogAPI().log(level, "fleet-tool", message);
  },
  loadSetting() { return undefined; },
  saveSetting() {},
  registerKeybind() { return () => {}; },
  log: fleetLogPort,
  now: () => Date.now(),
  getDeliverAs() { return undefined; },
};

export function registerFleetPiTools(pi: ExtensionAPI): void {
  configureJobSummaryCache(50, detachJobArchive);
  pi.registerMessageRenderer(CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer);

  const specs = createFleetToolRegistry(createFleetRegistryPorts(pi));

  for (const spec of specs) {
    pi.registerTool(toPiToolConfig(spec) as any);
  }
}

function createFleetRegistryPorts(pi: ExtensionAPI): FleetToolRegistryPorts {
  return {
    logDebug(category, message, options) {
      getLogAPI().debug(category, message, options as Parameters<ReturnType<typeof getLogAPI>["debug"]>[2]);
    },
    runAgentRequestBackground,
    enqueueCarrierCompletionPush(payload) {
      enqueueCarrierCompletionPush(pi, payload);
    },
  };
}

function toPiToolConfig(spec: AgentToolSpec): Record<string, unknown> {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    promptGuidelines: spec.promptGuidelines,
    parameters: spec.parameters,
    renderCall(args: unknown, theme: Theme, context: PiRenderContext) {
      return renderToolCall(spec, args, theme, context);
    },
    renderResult(result: unknown, options: { expanded: boolean; isPartial: boolean }, theme: Theme, context: PiRenderContext) {
      return renderToolResult(spec, result, options, theme, context);
    },
    execute(id: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      return spec.execute(params, buildAgentToolCtx(id, signal, ctx));
    },
  } as any;
}

function buildAgentToolCtx(toolCallId: string, signal: AbortSignal | undefined, ctx: ExtensionContext): AgentToolCtx {
  return {
    cwd: ctx.cwd,
    toolCallId,
    signal,
    log: fleetLogPort,
    now: () => Date.now(),
    ports: noopHostPorts,
  };
}

function renderToolCall(spec: AgentToolSpec, args: unknown, _theme: Theme, context: PiRenderContext): unknown {
  if (spec.name === "carrier_jobs") {
    return renderCarrierJobsCall(args, context);
  }
  if (spec.name === "carrier_squadron") {
    const rendered = spec.render?.call?.(args, buildAgentToolCtx("", undefined, { cwd: "" } as ExtensionContext)) as { carrier: string; count: number };
    return oneLine(`  ⚓ ${SQUADRON_BADGE_COLOR}Squadron${ANSI_RESET}: ${SQUADRON_BADGE_COLOR}${rendered.carrier} ×${rendered.count} subtasks${ANSI_RESET}`);
  }
  if (spec.name === "carrier_taskforce") {
    const carrier = spec.render?.call?.(args, buildAgentToolCtx("", undefined, { cwd: "" } as ExtensionContext)) as string;
    return oneLine(`  ⚓ ${TASKFORCE_BADGE_COLOR}Taskforce${ANSI_RESET}: ${TASKFORCE_BADGE_COLOR}${carrier}${ANSI_RESET}`);
  }
  if (spec.name === "carriers_sortie") {
    const payload = spec.render?.call?.(args, buildAgentToolCtx("", undefined, { cwd: "" } as ExtensionContext)) as string;
    return oneLine(`  ⚓ ${SORTIE_SUMMARY_COLOR}Sortie${ANSI_RESET}: ${payload}`);
  }
  return undefined;
}

function renderToolResult(
  spec: AgentToolSpec,
  result: unknown,
  options: { expanded: boolean; isPartial: boolean },
  _theme: Theme,
  context: PiRenderContext,
): unknown {
  if (spec.name === "carrier_jobs") {
    return renderCarrierJobsResult(result as CarrierJobsToolResult);
  }
  const entries = buildPreviewEntries(spec.name, context.args);
  const color = spec.name === "carrier_squadron"
    ? SQUADRON_BADGE_COLOR
    : spec.name === "carrier_taskforce"
      ? TASKFORCE_BADGE_COLOR
      : SORTIE_SUMMARY_COLOR;
  return {
    render(width: number) {
      return renderRequestPreview(entries, options.expanded, color, width);
    },
    invalidate() {},
  };
}

function oneLine(line: string): { render(): string[]; invalidate(): void } {
  return {
    render() { return [line]; },
    invalidate() {},
  };
}

function buildPreviewEntries(toolName: string, args: unknown): PreviewEntry[] {
  if (!isRecord(args)) return [];

  if (toolName === "carriers_sortie" && Array.isArray(args.carriers)) {
    return args.carriers
      .filter(isRecord)
      .map((carrier) => ({ label: String(carrier.carrier ?? ""), text: String(carrier.request ?? "") }));
  }

  if (toolName === "carrier_squadron" && Array.isArray(args.subtasks)) {
    return args.subtasks
      .filter(isRecord)
      .map((subtask) => ({ label: `"${String(subtask.title ?? "")}"`, text: String(subtask.request ?? "") }));
  }

  if (toolName === "carrier_taskforce" && typeof args.request === "string") {
    return [{ label: "", text: args.request }];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
