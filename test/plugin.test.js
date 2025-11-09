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
});
