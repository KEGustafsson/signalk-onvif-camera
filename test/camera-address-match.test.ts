/**
 * Regression tests for issue #51 — "Camera username/password not honored".
 *
 * Per-camera credentials are stored keyed by the address typed into the Camera
 * List, but looked up by the address a device is discovered under (the hostname
 * from the camera's advertised ONVIF XAddr). When those are not string-identical
 * the per-camera entry — including credentials — was silently ignored and the
 * global defaults were used instead. `normalizeAddressKey` is the reconciliation
 * used to match the two, so these tests pin down its behavior.
 */

const { normalizeAddressKey } = require('../index') as {
  normalizeAddressKey: (address: string) => string;
};

describe('normalizeAddressKey', () => {
  test('is exported for reuse', () => {
    expect(typeof normalizeAddressKey).toBe('function');
  });

  test('leaves a plain IPv4 address unchanged', () => {
    expect(normalizeAddressKey('192.168.1.50')).toBe('192.168.1.50');
  });

  test('strips a trailing port', () => {
    expect(normalizeAddressKey('192.168.1.50:8000')).toBe('192.168.1.50');
  });

  test('strips an http scheme and device_service path', () => {
    expect(normalizeAddressKey('http://192.168.1.50/onvif/device_service'))
      .toBe('192.168.1.50');
  });

  test('strips scheme, port and path together', () => {
    expect(normalizeAddressKey('http://192.168.1.50:8080/onvif/device_service'))
      .toBe('192.168.1.50');
  });

  test('lowercases and trims hostnames', () => {
    expect(normalizeAddressKey('  Camera-Bow.Local  ')).toBe('camera-bow.local');
  });

  test('drops a query string', () => {
    expect(normalizeAddressKey('192.168.1.50?profile=1')).toBe('192.168.1.50');
  });

  test('preserves a bracketed IPv6 literal without its port', () => {
    expect(normalizeAddressKey('[fe80::1]:8000')).toBe('fe80::1');
  });

  test('returns empty string for blank input', () => {
    expect(normalizeAddressKey('')).toBe('');
    expect(normalizeAddressKey('   ')).toBe('');
  });

  test('a typed address and its discovered XAddr resolve to the same key', () => {
    const typed = '192.168.1.50';
    const discovered = 'http://192.168.1.50/onvif/device_service';
    expect(normalizeAddressKey(typed)).toBe(normalizeAddressKey(discovered));
  });

  test('a typed address with a port matches the discovered host', () => {
    const typed = '192.168.1.50:8000';
    const discovered = '192.168.1.50';
    expect(normalizeAddressKey(typed)).toBe(normalizeAddressKey(discovered));
  });
});
