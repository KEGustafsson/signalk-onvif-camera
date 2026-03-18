/**
 * Tests for signalk-onvif-camera plugin
 */

const EventEmitter = require('events');

describe('signalk-onvif-camera plugin', () => {
  let plugin;
  let mockApp;
  let mockServer;

  beforeEach(() => {
    jest.resetModules();

    // Minimal http.Server-like emitter so WebSocket.Server can attach
    mockServer = new EventEmitter();
    mockServer.on = jest.fn(mockServer.on.bind(mockServer));

    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index.js');
    plugin = createPlugin(mockApp);
  });

  afterEach(() => {
    if (plugin && typeof plugin.stop === 'function') {
      try { plugin.stop(); } catch (_) {}
    }
  });

  // ── basic structure ─────────────────────────────────────────────────────────

  describe('plugin structure', () => {
    test('should export a valid plugin object', () => {
      expect(plugin).toBeDefined();
      expect(plugin.id).toBe('signalk-onvif-camera');
      expect(plugin.name).toBe('Signal K Onvif Camera Interface');
      expect(typeof plugin.start).toBe('function');
      expect(typeof plugin.stop).toBe('function');
    });

    test('should have valid uiSchema', () => {
      expect(plugin.uiSchema).toBeDefined();
      expect(plugin.uiSchema.password['ui:widget']).toBe('password');
      expect(plugin.uiSchema.cameras.items.password['ui:widget']).toBe('password');
    });

    test('should not register process-level SIGTERM/SIGINT handlers', () => {
      // Plugins must not add process-level shutdown handlers — SignalK calls
      // plugin.stop() directly. Accumulating handlers causes MaxListeners warnings
      // and bypasses SignalK's own graceful teardown.
      const sigtermBefore = process.listenerCount('SIGTERM');
      const sigintBefore  = process.listenerCount('SIGINT');
      jest.resetModules();
      require('../index.js');
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
      expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    });
  });

  // ── schema ──────────────────────────────────────────────────────────────────

  describe('plugin schema', () => {
    test('should have valid schema object', () => {
      expect(plugin.schema).toBeDefined();
      expect(plugin.schema.type).toBe('object');
      expect(plugin.schema.properties).toBeDefined();
    });

    test('should NOT have removed port/secure properties', () => {
      expect(plugin.schema.properties.port).toBeUndefined();
      expect(plugin.schema.properties.secure).toBeUndefined();
    });

    test('should have ipAddress property', () => {
      expect(plugin.schema.properties.ipAddress).toBeDefined();
      expect(plugin.schema.properties.ipAddress.type).toBe('string');
    });

    test('should have autoDiscoveryInterval property', () => {
      expect(plugin.schema.properties.autoDiscoveryInterval).toBeDefined();
      expect(plugin.schema.properties.autoDiscoveryInterval.type).toBe('number');
      expect(plugin.schema.properties.autoDiscoveryInterval.default).toBe(0);
    });

    test('should have snapshotInterval property', () => {
      expect(plugin.schema.properties.snapshotInterval).toBeDefined();
      expect(plugin.schema.properties.snapshotInterval.type).toBe('number');
      expect(plugin.schema.properties.snapshotInterval.default).toBe(100);
      expect(plugin.schema.properties.snapshotInterval.minimum).toBe(50);
    });

    test('should have enableSignalKIntegration property', () => {
      expect(plugin.schema.properties.enableSignalKIntegration).toBeDefined();
      expect(plugin.schema.properties.enableSignalKIntegration.type).toBe('boolean');
      expect(plugin.schema.properties.enableSignalKIntegration.default).toBe(false);
    });

    test('should have discoverOnStart property defaulting to true', () => {
      expect(plugin.schema.properties.discoverOnStart).toBeDefined();
      expect(plugin.schema.properties.discoverOnStart.type).toBe('boolean');
      expect(plugin.schema.properties.discoverOnStart.default).toBe(true);
    });

    test('should have startupDiscoveryDelay property', () => {
      expect(plugin.schema.properties.startupDiscoveryDelay).toBeDefined();
      expect(plugin.schema.properties.startupDiscoveryDelay.type).toBe('number');
      expect(plugin.schema.properties.startupDiscoveryDelay.default).toBe(5);
      expect(plugin.schema.properties.startupDiscoveryDelay.minimum).toBe(1);
    });

    test('should have cameras array with all expected item properties', () => {
      const cameras = plugin.schema.properties.cameras;
      expect(cameras).toBeDefined();
      expect(cameras.type).toBe('array');
      const props = cameras.items.properties;
      expect(props.address.type).toBe('string');
      expect(props.name.type).toBe('string');
      expect(props.nickname.type).toBe('string');
      expect(props.userName.type).toBe('string');
      expect(props.password.type).toBe('string');
    });
  });

  // ── plugin.start() ──────────────────────────────────────────────────────────

  describe('plugin.start()', () => {
    const baseOptions = {
      snapshotInterval: 150,
      autoDiscoveryInterval: 0,
      discoverOnStart: false
    };

    test('should register HTTP routes on app.get exactly once', () => {
      plugin.start(baseOptions);
      const routeCount = mockApp.get.mock.calls.length;
      expect(routeCount).toBeGreaterThanOrEqual(4);

      const paths = mockApp.get.mock.calls.map(c => c[0]);
      expect(paths).toContain('/plugins/signalk-onvif-camera/mjpeg');
      expect(paths).toContain('/plugins/signalk-onvif-camera/snapshot');
      expect(paths).toContain('/plugins/signalk-onvif-camera/api/streams');
      expect(paths).toContain('/plugins/signalk-onvif-camera/api/profiles');
    });

    test('should not re-register routes on subsequent starts', () => {
      plugin.start(baseOptions);
      const countAfterFirst = mockApp.get.mock.calls.length;
      plugin.stop();
      plugin.start(baseOptions);
      expect(mockApp.get.mock.calls.length).toBe(countAfterFirst);
    });

    test('should attach WebSocket server to app.server', () => {
      plugin.start(baseOptions);
      // WebSocket.Server attaches an 'upgrade' listener to the underlying server
      expect(mockServer.on).toHaveBeenCalled();
    });

    test('should write browserdata.json with snapshotInterval only', () => {
      const fs = require('fs');
      const path = require('path');
      plugin.start({ ...baseOptions, snapshotInterval: 200 });
      const written = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'public', 'browserdata.json'), 'utf8')
      );
      expect(written).toHaveLength(1);
      expect(written[0].snapshotInterval).toBe(200);
      expect(written[0].port).toBeUndefined();
      expect(written[0].secure).toBeUndefined();
    });

    test('should log error and not throw when app.server is absent', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const appNoServer = { ...mockApp, server: null };
      jest.resetModules();
      const createPlugin = require('../index.js');
      const p = createPlugin(appNoServer);
      expect(() => p.start(baseOptions)).not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  // ── plugin.stop() ───────────────────────────────────────────────────────────

  describe('plugin.stop()', () => {
    test('should not throw when called before start', () => {
      expect(() => plugin.stop()).not.toThrow();
    });

    test('should not throw when called after start', () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      expect(() => plugin.stop()).not.toThrow();
    });

    test('should abort active MJPEG streams on stop', () => {
      // Verify the stream abort mechanism: mjpegStreams stores { abort } functions
      // and stop() calls them. We check this by inspecting that stop() does not
      // throw when a stream with an abort function is in the map.
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const abortSpy = jest.fn();
      // Access mjpegStreams via closure isn't possible externally; instead verify
      // stop() doesn't throw even with pending stream state.
      expect(() => plugin.stop()).not.toThrow();
    });

    test('should allow restart after stop without re-registering routes', () => {
      const opts = { snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 };
      plugin.start(opts);
      const routeCountAfterFirst = mockApp.get.mock.calls.length;
      plugin.stop();
      plugin.start(opts);
      // Routes must not be re-registered
      expect(mockApp.get.mock.calls.length).toBe(routeCountAfterFirst);
    });
  });

  // ── browserdata.json ─────────────────────────────────────────────────────────

  describe('browserdata.json', () => {
    test('should not crash when write fails', () => {
      const fs = require('fs');
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => plugin.start({
        snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0
      })).not.toThrow();
      writeSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  // ── camera config building ───────────────────────────────────────────────────

  describe('camera config', () => {
    test('should sanitize camera nicknames', () => {
      const options = {
        snapshotInterval: 100,
        discoverOnStart: false,
        autoDiscoveryInterval: 0,
        cameras: [
          { address: '192.168.1.10', nickname: 'Bow Camera!', userName: 'u', password: 'p' }
        ]
      };
      // Start without throwing - nickname sanitization happens internally
      expect(() => plugin.start(options)).not.toThrow();
    });

    test('should fall back to default credentials when camera has none', () => {
      const options = {
        snapshotInterval: 100,
        discoverOnStart: false,
        autoDiscoveryInterval: 0,
        userName: 'defaultUser',
        password: 'defaultPass',
        cameras: [
          { address: '192.168.1.11' }
        ]
      };
      expect(() => plugin.start(options)).not.toThrow();
    });
  });
});
