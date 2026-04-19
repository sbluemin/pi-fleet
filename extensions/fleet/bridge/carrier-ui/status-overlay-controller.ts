import type {
  CarrierCliType,
  CarrierOverlayCallbacks,
  CarrierStatusEntry,
  CliModelInfo,
  CliTypeChangeResult,
  ModelSelection,
  ResolvedCliSelection,
} from "./types.js";
import type { CarrierConfig } from "../../shipyard/carrier/types.js";

interface StoredCliSelection {
  model?: string;
  effort?: string;
  budgetTokens?: number;
  direct?: boolean;
}

interface StatusOverlayControllerDeps {
  getEntries: () => CarrierStatusEntry[];
  getRegisteredOrder: () => string[];
  getRegisteredCarrierConfig: (carrierId: string) => CarrierConfig | undefined;
  getCurrentModelSelection: (carrierId: string) => (ModelSelection & { direct?: boolean }) | undefined;
  getAvailableModels: (cliType: CarrierCliType) => CliModelInfo;
  getPerCliSettings: (carrierId: string, cliType: CarrierCliType) => StoredCliSelection | undefined;
  savePerCliSettings: (carrierId: string, cliType: CarrierCliType, selection: StoredCliSelection) => void;
  updateCarrierCliType: (carrierId: string, cliType: CarrierCliType) => void;
  updateModelSelection: (
    carrierId: string,
    selection: ModelSelection & { direct?: boolean },
  ) => Promise<void>;
  refreshAgentPanel: () => void;
  syncModelConfig: () => void;
  notifyStatusUpdate: () => void;
  saveCliTypeOverrides: (overrides: Record<string, string>) => void;
}

const CLAUDE_CLI_TYPE: CarrierCliType = "claude";

export class StatusOverlayController implements Pick<
  CarrierOverlayCallbacks,
  "changeCliType" | "changeCliTypes" | "resetCliTypesToDefault"
> {
  private readonly deps: StatusOverlayControllerDeps;

  constructor(deps: StatusOverlayControllerDeps) {
    this.deps = deps;
  }

  async changeCliType(
    carrierId: string,
    newCliType: CarrierCliType,
  ): Promise<ResolvedCliSelection> {
    const result = await this.applyCliTypeChange(carrierId, newCliType);
    return result.selection;
  }

  async changeCliTypes(
    updates: Array<{ carrierId: string; newCliType: CarrierCliType }>,
  ): Promise<CliTypeChangeResult[]> {
    const normalized = this.normalizeCliUpdates(updates);
    return Promise.all(
      normalized.map(({ carrierId, newCliType }) => this.applyCliTypeChange(carrierId, newCliType)),
    );
  }

  async resetCliTypesToDefault(): Promise<CliTypeChangeResult[]> {
    const updates = this.deps.getRegisteredOrder()
      .map((carrierId) => {
        const config = this.deps.getRegisteredCarrierConfig(carrierId);
        if (!config || config.cliType === config.defaultCliType) {
          return null;
        }
        return {
          carrierId,
          newCliType: config.defaultCliType as CarrierCliType,
        };
      })
      .filter((update): update is { carrierId: string; newCliType: CarrierCliType } => update !== null);
    return this.changeCliTypes(updates);
  }

  private async applyCliTypeChange(
    carrierId: string,
    newCliType: CarrierCliType,
  ): Promise<CliTypeChangeResult> {
    const currentConfig = this.deps.getRegisteredCarrierConfig(carrierId);
    const currentCliType = currentConfig?.cliType as CarrierCliType | undefined;
    if (currentCliType) {
      const currentSelection = this.deps.getCurrentModelSelection(carrierId);
      if (currentSelection) {
        this.deps.savePerCliSettings(carrierId, currentCliType, {
          model: currentSelection.model,
          effort: currentSelection.effort,
          budgetTokens: currentSelection.budgetTokens,
          direct: currentSelection.direct,
        });
      }
    }

    this.deps.updateCarrierCliType(carrierId, newCliType);
    this.deps.refreshAgentPanel();
    this.persistCliOverrides();

    const resolved = this.resolveCliSelection(carrierId, newCliType);

    try {
      await this.deps.updateModelSelection(carrierId, {
        model: resolved.model,
        effort: resolved.effort ?? undefined,
        budgetTokens: resolved.budgetTokens ?? undefined,
        direct: this.deps.getPerCliSettings(carrierId, newCliType)?.direct,
      });
    } catch (error) {
      if (currentCliType && currentCliType !== newCliType) {
        this.deps.updateCarrierCliType(carrierId, currentCliType);
        this.deps.refreshAgentPanel();
        this.persistCliOverrides();
      }
      throw error;
    } finally {
      this.deps.syncModelConfig();
      this.deps.notifyStatusUpdate();
    }

    return {
      carrierId,
      newCliType,
      selection: resolved,
    };
  }

  private resolveCliSelection(
    carrierId: string,
    cliType: CarrierCliType,
  ): ResolvedCliSelection {
    const saved = this.deps.getPerCliSettings(carrierId, cliType);
    const provider = this.deps.getAvailableModels(cliType);
    const hasSavedModel = !!(saved?.model && provider.models.some((model) => model.modelId === saved.model));
    const effortLevels = provider.reasoningEffort.levels ?? [];
    const defaultEffort = provider.reasoningEffort.default ?? null;
    const resolvedEffort = saved?.effort && effortLevels.includes(saved.effort)
      ? saved.effort
      : defaultEffort;
    const resolvedBudgetTokens = cliType === CLAUDE_CLI_TYPE && resolvedEffort && resolvedEffort !== "none"
      ? saved?.budgetTokens ?? provider.defaultBudgetTokens?.[resolvedEffort] ?? null
      : null;

    return {
      model: hasSavedModel ? saved!.model! : provider.defaultModel,
      effort: resolvedEffort,
      isDefault: !hasSavedModel,
      budgetTokens: resolvedBudgetTokens,
    };
  }

  private persistCliOverrides(): void {
    const overrides: Record<string, string> = {};
    for (const carrierId of this.deps.getRegisteredOrder()) {
      const config = this.deps.getRegisteredCarrierConfig(carrierId);
      if (config && config.cliType !== config.defaultCliType) {
        overrides[carrierId] = config.cliType;
      }
    }
    this.deps.saveCliTypeOverrides(overrides);
  }

  private normalizeCliUpdates(
    updates: Array<{ carrierId: string; newCliType: CarrierCliType }>,
  ): Array<{ carrierId: string; newCliType: CarrierCliType }> {
    const deduped = new Map<string, CarrierCliType>();
    for (const update of updates) {
      deduped.set(update.carrierId, update.newCliType);
    }
    return [...deduped.entries()].map(([carrierId, newCliType]) => ({ carrierId, newCliType }));
  }
}
