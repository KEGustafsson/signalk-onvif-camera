/**
 * Tests for configuration defaults
 */

const config = require('../lib/config/defaults');

describe('Configuration defaults', () => {
  test('should have server configuration', () => {
    expect(config.server).toBeDefined();
    expect(config.server.maxConnections).toBeGreaterThan(0);
  });

  test('should have discovery configuration', () => {
    expect(config.discovery).toBeDefined();
    expect(config.discovery.interval).toBeGreaterThan(0);
    expect(config.discovery.retryMax).toBeGreaterThan(0);
    expect(config.discovery.wait).toBeGreaterThan(0);
  });

  test('should have PTZ configuration', () => {
    expect(config.ptz).toBeDefined();
    expect(config.ptz.defaultSpeed).toBe(1.0);
    expect(config.ptz.minSpeed).toBe(-1.0);
    expect(config.ptz.maxSpeed).toBe(1.0);
    expect(config.ptz.defaultTimeout).toBeGreaterThan(0);
  });

  test('should have snapshot configuration', () => {
    expect(config.snapshot).toBeDefined();
    expect(config.snapshot.defaultInterval).toBeGreaterThan(0);
    expect(config.snapshot.maxSize).toBeGreaterThan(0);
    expect(config.snapshot.timeout).toBeGreaterThan(0);
  });

  test('should have HTTP configuration', () => {
    expect(config.http).toBeDefined();
    expect(config.http.timeout).toBeGreaterThan(0);
  });

  test('should have WebSocket configuration', () => {
    expect(config.websocket).toBeDefined();
    expect(config.websocket.pingInterval).toBeGreaterThan(0);
    expect(config.websocket.pongTimeout).toBeGreaterThan(0);
  });

  test('should not have defaultPort (plugin uses SignalK server port)', () => {
    expect(config.server.defaultPort).toBeUndefined();
  });

  test('should not have certificate config (plugin no longer manages TLS)', () => {
    expect(config.certificate).toBeUndefined();
  });
});
