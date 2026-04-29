export interface BridgeStateStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}

const globalBridgeStateStorage: BridgeStateStorage = {
  get<T>(key: string): T | undefined {
    return (globalThis as unknown as Record<string, unknown>)[key] as T | undefined;
  },
  set<T>(key: string, value: T): void {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  },
  delete(key: string): void {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  },
};

let activeBridgeStateStorage: BridgeStateStorage = globalBridgeStateStorage;

export function configureBridgeStateStorage(storage: BridgeStateStorage | null): void {
  activeBridgeStateStorage = storage ?? globalBridgeStateStorage;
}

export function getBridgeStateStorage(): BridgeStateStorage {
  return activeBridgeStateStorage;
}

export function readBridgeState<T>(key: string): T | undefined {
  return activeBridgeStateStorage.get<T>(key);
}

export function writeBridgeState<T>(key: string, value: T): T {
  activeBridgeStateStorage.set(key, value);
  return value;
}

export function clearBridgeState(key: string): void {
  activeBridgeStateStorage.delete(key);
}
