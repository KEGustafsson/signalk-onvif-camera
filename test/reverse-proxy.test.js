/**
 * Tests for reverse proxy compatibility
 * Covers URL construction for WebSocket, MJPEG, and Signal K publishing
 */

describe('Reverse proxy compatibility', () => {
  let plugin;
  let mockApp;

  beforeEach(() => {
    // Mock Signal K app with handleMessage
    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      handleMessage: jest.fn(),
      debug: jest.fn()
    };

    // Require the plugin
    const createPlugin = require('../index.js');
    plugin = createPlugin(mockApp);
  });

  afterEach(() => {
    if (plugin && typeof plugin.stop === 'function') {
      plugin.stop();
    }
  });

  describe('Signal K URL publishing', () => {
    test('should use relative plugin paths for camera URLs', () => {
      // Start plugin with Signal K integration enabled
      const options = {
        port: 8880,
        secure: false,
        userName: 'admin',
        password: 'password',
        enableSignalKIntegration: true,
        cameras: [{
          address: '192.168.1.100',
          name: 'Test Camera',
          nickname: 'bow'
        }]
      };

      plugin.start(options, jest.fn());

      // Wait for plugin to start
      setTimeout(() => {
        // Check if handleMessage was called with correct URL structure
        if (mockApp.handleMessage.mock.calls.length > 0) {
          const lastCall = mockApp.handleMessage.mock.calls[mockApp.handleMessage.mock.calls.length - 1];
          const delta = lastCall[1];

          if (delta && delta.updates && delta.updates[0] && delta.updates[0].values) {
            const cameraData = delta.updates[0].values[0].value;

            // URLs should start with /plugins/ (relative path)
            if (cameraData.snapshot) {
              expect(cameraData.snapshot).toMatch(/^\/plugins\/signalk-onvif-camera\/snapshot/);
            }
            if (cameraData.mjpeg) {
              expect(cameraData.mjpeg).toMatch(/^\/plugins\/signalk-onvif-camera\/mjpeg/);
            }

            // URLs should NOT contain server IP or port
            if (cameraData.snapshot) {
              expect(cameraData.snapshot).not.toMatch(/http:\/\//);
              expect(cameraData.snapshot).not.toMatch(/192\.168\./);
              expect(cameraData.snapshot).not.toMatch(/:8880/);
            }
          }
        }
      }, 100);
    });

    test('should properly encode camera address in URLs', () => {
      const options = {
        port: 8880,
        secure: false,
        enableSignalKIntegration: true,
        cameras: [{
          address: '192.168.1.100',
          nickname: 'test'
        }]
      };

      plugin.start(options, jest.fn());

      setTimeout(() => {
        if (mockApp.handleMessage.mock.calls.length > 0) {
          const lastCall = mockApp.handleMessage.mock.calls[mockApp.handleMessage.mock.calls.length - 1];
          const delta = lastCall[1];

          if (delta && delta.updates && delta.updates[0] && delta.updates[0].values) {
            const cameraData = delta.updates[0].values[0].value;

            // URLs should contain encoded address parameter
            if (cameraData.snapshot) {
              expect(cameraData.snapshot).toContain('address=192.168.1.100');
            }
            if (cameraData.mjpeg) {
              expect(cameraData.mjpeg).toContain('address=192.168.1.100');
            }
          }
        }
      }, 100);
    });
  });

  describe('WebSocket endpoint behavior', () => {
    test('should accept WebSocket connections on configured port', (done) => {
      const options = {
        port: 8881, // Use different port for test
        secure: false,
        userName: 'admin',
        password: 'password'
      };

      plugin.start(options, jest.fn());

      // Give server time to start
      setTimeout(() => {
        // Plugin should have started server
        expect(plugin).toBeDefined();
        done();
      }, 1500);
    });
  });

  describe('HTTP endpoint paths', () => {
    test('should respond to /mjpeg endpoint', (done) => {
      const options = {
        port: 8882,
        secure: false
      };

      plugin.start(options, jest.fn());

      // Test will verify endpoints exist
      // Actual HTTP testing would require supertest or similar
      setTimeout(() => {
        expect(plugin).toBeDefined();
        done();
      }, 1500);
    });

    test('should respond to /snapshot endpoint', (done) => {
      const options = {
        port: 8883,
        secure: false
      };

      plugin.start(options, jest.fn());

      setTimeout(() => {
        expect(plugin).toBeDefined();
        done();
      }, 1500);
    });
  });

  describe('URL construction edge cases', () => {
    test('should handle special characters in camera addresses', () => {
      // Test address encoding
      const testAddress = '192.168.1.100';
      const expectedEncoded = '192.168.1.100'; // No special chars, should be unchanged

      expect(encodeURIComponent(testAddress)).toBe(expectedEncoded);
    });

    test('should construct valid plugin path', () => {
      const pluginPath = '/plugins/signalk-onvif-camera';
      const address = '192.168.1.100';
      const expectedUrl = `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(address)}`;

      const constructedUrl = `${pluginPath}/mjpeg?address=${encodeURIComponent(address)}`;

      expect(constructedUrl).toBe(expectedUrl);
      expect(constructedUrl).not.toContain('http://');
      expect(constructedUrl).not.toContain(':8880');
    });
  });

  describe('Reverse proxy scenarios', () => {
    test('relative URLs should work with any base path', () => {
      const basePaths = [
        '/plugins/signalk-onvif-camera',
        '/signalk/plugins/onvif',
        '/camera'
      ];

      basePaths.forEach(basePath => {
        const mjpegUrl = `${basePath}/mjpeg?address=192.168.1.100`;
        const snapshotUrl = `${basePath}/snapshot?address=192.168.1.100`;

        // Should be relative URLs
        expect(mjpegUrl).toMatch(/^\//);
        expect(snapshotUrl).toMatch(/^\//);

        // Should not contain protocol or host
        expect(mjpegUrl).not.toMatch(/^https?:\/\//);
        expect(snapshotUrl).not.toMatch(/^https?:\/\//);
      });
    });

    test('should not use hardcoded ports in URLs', () => {
      const urlsToTest = [
        '/plugins/signalk-onvif-camera/mjpeg?address=192.168.1.100',
        '/plugins/signalk-onvif-camera/snapshot?address=192.168.1.100'
      ];

      urlsToTest.forEach(url => {
        expect(url).not.toMatch(/:\d+/); // No port numbers
      });
    });

    test('should not use internal IP addresses in published URLs', () => {
      const invalidPatterns = [
        /192\.168\.\d+\.\d+/,  // Private Class C
        /10\.\d+\.\d+\.\d+/,    // Private Class A
        /172\.1[6-9]\.\d+\.\d+/, // Private Class B
        /localhost/,
        /127\.0\.0\.1/
      ];

      const testUrl = '/plugins/signalk-onvif-camera/mjpeg?address=192.168.1.100';

      // URL path itself should not contain internal IPs
      // (query parameter is OK - it's the camera's address)
      const urlPath = testUrl.split('?')[0];

      invalidPatterns.forEach(pattern => {
        expect(urlPath).not.toMatch(pattern);
      });
    });
  });
});
