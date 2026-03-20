import {
  buildDiscoveryOptions,
  DEVICE_SEARCHING_PLACEHOLDER,
  DEVICE_SELECT_PLACEHOLDER,
  resolveSelectedDiscoveryAddress
} from '../src/discovery';

describe('browser discovery helpers', () => {
  test('builds device options from the latest discovery result only', () => {
    expect(buildDiscoveryOptions({
      '10.0.0.20': { address: '10.0.0.20', name: 'Camera A' }
    })).toEqual([
      { value: '10.0.0.20', label: 'Camera A (10.0.0.20)' }
    ]);
  });

  test('drops stale selections that are no longer in the discovery result', () => {
    expect(resolveSelectedDiscoveryAddress('10.0.0.21', {
      '10.0.0.20': { address: '10.0.0.20', name: 'Camera A' }
    })).toBe(DEVICE_SELECT_PLACEHOLDER);
  });

  test('exports the browser discovery placeholders', () => {
    expect(DEVICE_SELECT_PLACEHOLDER).toBe('Select a device');
    expect(DEVICE_SEARCHING_PLACEHOLDER).toBe('now searching...');
  });
});
