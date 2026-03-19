export interface ConnectRequestPayload extends Record<string, unknown> {
  address: string;
}

export function buildConnectRequest(address: string): ConnectRequestPayload {
  return { address };
}

export function hasSelectableAddress(address: string): boolean {
  return address !== '' && address !== 'Select a device' && address !== 'now searching...';
}
