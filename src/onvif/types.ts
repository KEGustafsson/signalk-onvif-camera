export interface LegacyOnvifDevice {
  readonly address: string;
  readonly services: {
    readonly ptz?: { gotoHomePosition(params: Record<string, unknown>, callback: (error: unknown, result?: unknown) => void): void };
    readonly events?: unknown;
  };
  setAuth(user?: string, pass?: string): void;
  init(callback: (error: unknown, result?: Record<string, unknown>) => void): void;
  fetchSnapshot(callback: (error: unknown, result?: { headers?: Record<string, string>; body?: Buffer }) => void): void;
  ptzMove(params: Record<string, unknown>, callback: (error?: unknown) => void): void;
  ptzStop(callback: (error?: unknown) => void): void;
  changeProfile(token?: string | number): unknown;
  getProfileList(): unknown[];
  getCurrentProfile(): unknown;
  getInformation(): Record<string, unknown>;
}
