import { DEVICE_SEARCHING_PLACEHOLDER, DEVICE_SELECT_PLACEHOLDER } from './discovery';

export interface ConnectRequestPayload extends Record<string, unknown> {
  address: string;
}

export function buildConnectRequest(address: string): ConnectRequestPayload {
  return { address };
}

export function hasSelectableAddress(address: string): boolean {
  return address !== ''
    && address !== DEVICE_SELECT_PLACEHOLDER
    && address !== DEVICE_SEARCHING_PLACEHOLDER;
}
