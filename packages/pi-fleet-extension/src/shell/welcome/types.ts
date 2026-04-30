export interface WelcomeBridge {
  dismiss: () => void;
}

let welcomeBridge: WelcomeBridge | null = null;

export function getWelcomeBridge(): WelcomeBridge | null {
  return welcomeBridge;
}

export function setWelcomeBridge(bridge: WelcomeBridge | null): void {
  welcomeBridge = bridge;
}
