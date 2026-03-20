export interface DeviceSummary {
  address: string;
  name: string;
}

export type DeviceSummaryMap = Record<string, DeviceSummary>;

export interface DiscoveryOption {
  value: string;
  label: string;
}

export const DEVICE_SELECT_PLACEHOLDER = 'Select a device';
export const DEVICE_SEARCHING_PLACEHOLDER = 'now searching...';

export function buildDiscoveryOptions(devices: DeviceSummaryMap): DiscoveryOption[] {
  return Object.keys(devices).map((key) => {
    const device = devices[key];
    return {
      value: device.address,
      label: `${device.name} (${device.address})`
    };
  });
}

export function resolveSelectedDiscoveryAddress(currentSelection: string, devices: DeviceSummaryMap): string {
  return currentSelection && devices[currentSelection]
    ? currentSelection
    : DEVICE_SELECT_PLACEHOLDER;
}
