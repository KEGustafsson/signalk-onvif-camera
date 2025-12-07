/**
 * Basic smoke tests for signalk-onvif-camera plugin
 */

describe('signalk-onvif-camera plugin', () => {
  let plugin;
  let mockApp;

  beforeEach(() => {
    // Mock Signal K app
    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn()
    };

    // Require the plugin
    const createPlugin = require('../index.js');
    plugin = createPlugin(mockApp);
  });

  test('should export a valid plugin object', () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe('signalk-onvif-camera');
    expect(plugin.name).toBe('Signal K Onvif Camera Interface');
    expect(typeof plugin.start).toBe('function');
    expect(typeof plugin.stop).toBe('function');
  });

  test('should have valid schema', () => {
    expect(plugin.schema).toBeDefined();
    expect(plugin.schema.type).toBe('object');
    expect(plugin.schema.properties).toBeDefined();
    expect(plugin.schema.properties.port).toBeDefined();
    expect(plugin.schema.properties.secure).toBeDefined();
  });

  test('should have valid uiSchema', () => {
    expect(plugin.uiSchema).toBeDefined();
    expect(plugin.uiSchema.password).toBeDefined();
    expect(plugin.uiSchema.password['ui:widget']).toBe('password');
  });

  // New feature tests
  describe('new streaming features schema', () => {
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

    test('should have cameras array with nickname property', () => {
      expect(plugin.schema.properties.cameras).toBeDefined();
      expect(plugin.schema.properties.cameras.type).toBe('array');
      expect(plugin.schema.properties.cameras.items.properties.nickname).toBeDefined();
      expect(plugin.schema.properties.cameras.items.properties.nickname.type).toBe('string');
    });

    test('should have per-camera credentials properties', () => {
      const cameraProps = plugin.schema.properties.cameras.items.properties;
      expect(cameraProps.userName).toBeDefined();
      expect(cameraProps.password).toBeDefined();
      expect(cameraProps.defaultProfile).toBeDefined();
    });

    test('should have camera-specific password hidden in uiSchema', () => {
      expect(plugin.uiSchema.cameras).toBeDefined();
      expect(plugin.uiSchema.cameras.items.password['ui:widget']).toBe('password');
    });
  });
});
