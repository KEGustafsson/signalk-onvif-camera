import { buildConnectRequest } from '../src/connect';
import { hasSelectableAddress } from '../src/connect';

describe('browser connect request', () => {
  test('builds a connect request with only the selected address', () => {
    expect(buildConnectRequest('10.0.0.20')).toEqual({
      address: '10.0.0.20'
    });
  });

  test('rejects placeholder values as a selectable address', () => {
    expect(hasSelectableAddress('')).toBe(false);
    expect(hasSelectableAddress('Select a device')).toBe(false);
    expect(hasSelectableAddress('now searching...')).toBe(false);
    expect(hasSelectableAddress('10.0.0.20')).toBe(true);
  });
});
