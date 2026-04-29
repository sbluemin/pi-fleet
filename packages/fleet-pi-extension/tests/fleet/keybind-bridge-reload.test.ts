import { describe, expect, it, vi } from "vitest";

import type { CoreKeybindAPI, KeybindRegistration } from "@sbluemin/fleet-core/core-services/keybind";
import {
  _bootstrapKeybind,
  getKeybindAPI,
  prepareKeybindBridgeForExtensionLoad,
} from "../../src/config-bridge/keybind/bridge.js";

describe("keybind bridge reload lifecycle", () => {
  it("clears stale keybind implementation before extension reload registrations", () => {
    const staleRegister = vi.fn(() => {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    });
    _bootstrapKeybind(makeApi(staleRegister));

    prepareKeybindBridgeForExtensionLoad();
    const binding = makeBinding();

    expect(() => getKeybindAPI().register(binding)).not.toThrow();
    expect(staleRegister).not.toHaveBeenCalled();

    const nextRegister = vi.fn();
    _bootstrapKeybind(makeApi(nextRegister));

    expect(nextRegister).toHaveBeenCalledWith(binding);
  });
});

function makeApi(register: (binding: KeybindRegistration) => void): CoreKeybindAPI {
  return {
    register,
    getBindings: () => [],
    getKey: () => undefined,
  };
}

function makeBinding(): KeybindRegistration {
  return {
    extension: "core-settings",
    action: "popup",
    defaultKey: "alt+/",
    description: "설정 오버레이 팝업 표시",
    handler: () => {},
  };
}
