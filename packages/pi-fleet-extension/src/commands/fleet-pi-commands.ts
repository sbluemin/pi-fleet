import { type ExtensionAPI, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

import { refreshStatusNow } from "../provider/service-status-store.js";
import { getDeliverAs, setDeliverAs } from "../tools/settings/fleet-push-mode-settings.js";
import {
  setCarrierJobsVerbose,
  toggleCarrierJobsVerbose,
} from "../tools/carrier_jobs/verbose-toggle.js";

export function registerFleetPiCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:agent:status", {
    description: "지원 CLI 서비스 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });

  pi.registerCommand("fleet:jobs:verbose", {
    description: "carrier_jobs 렌더링 상세 모드 토글",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      const enabled = value === "on"
        ? (setCarrierJobsVerbose(true), true)
        : value === "off"
          ? (setCarrierJobsVerbose(false), false)
          : toggleCarrierJobsVerbose();
      ctx.ui.notify(`Carrier Jobs verbose: ${enabled ? "ON" : "OFF"}`, "info");
    },
  });

  pi.registerCommand("fleet:jobs:mode", {
    description: "carrier-result push delivery mode selector (follow-up | steer)",
    handler: async (_args, ctx) => {
      const current = getDeliverAs();
      const items: SelectItem[] = [
        {
          value: "followUp",
          label: current === "followUp" ? "Follow-up (recommended, default) (active)" : "Follow-up (recommended, default)",
          description: "Carrier result delivered after current turn ends. Safe with batch window. doctrinal default.",
        },
        {
          value: "steer",
          label: current === "steer" ? "Steer (advanced) (active)" : "Steer (advanced)",
          description: "Uses the same 2s batch queue, then may interrupt an ongoing response when the push fires; FIFO race-safety unverified. Use only when latency truly matters.",
        },
      ];

      const result = await ctx.ui.custom<"followUp" | "steer" | null>((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Select Push Delivery Mode"))));

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        selectList.onSelect = (item) => done(item.value as "followUp" | "steer");
        selectList.onCancel = () => done(null);

        container.addChild(selectList);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      });

      if (!result) return;
      await setDeliverAs(result);
      const label = result === "followUp" ? "Follow-up (recommended, default)" : "Steer (advanced)";
      ctx.ui.notify(`Push delivery mode: ${label}`, "info");
    },
  });
}
