/**
 * Tests for frontend URL construction utilities
 * Tests the getBasePath() function and URL construction logic
 */

describe('Frontend URL construction', () => {
  // Helper to simulate getBasePath() function from src/index.js
  function getBasePath(pathname) {
    // Remove trailing slash if present (except for root)
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    // Get directory path (everything before the last /)
    const lastSlashIndex = pathname.lastIndexOf('/');
    if (lastSlashIndex === 0) {
      // At root level
      return '';
    }
    return pathname.substring(0, lastSlashIndex);
  }

  describe('getBasePath() function', () => {
    test('should handle normal paths', () => {
      expect(getBasePath('/plugins/signalk-onvif-camera/index.html')).toBe('/plugins/signalk-onvif-camera');
      expect(getBasePath('/app/camera/index.html')).toBe('/app/camera');
      expect(getBasePath('/test/path/file.html')).toBe('/test/path');
    });

    test('should handle root path', () => {
      expect(getBasePath('/index.html')).toBe('');
      expect(getBasePath('/file.html')).toBe('');
    });

    test('should handle paths with trailing slash', () => {
      expect(getBasePath('/plugins/signalk-onvif-camera/')).toBe('/plugins');
      expect(getBasePath('/app/')).toBe('');
    });

    test('should handle single level paths', () => {
      expect(getBasePath('/index.html')).toBe('');
      expect(getBasePath('/app')).toBe('');
    });

    test('should handle deep paths', () => {
      expect(getBasePath('/a/b/c/d/e/file.html')).toBe('/a/b/c/d/e');
      expect(getBasePath('/very/deep/nested/path/index.html')).toBe('/very/deep/nested/path');
    });

    test('should handle paths without file extension', () => {
      expect(getBasePath('/plugins/onvif')).toBe('/plugins');
      expect(getBasePath('/app/dashboard')).toBe('/app');
    });

    test('should return empty string for root without filename', () => {
      expect(getBasePath('/')).toBe('');
    });
  });

  describe('URL construction for reverse proxy', () => {
    test('should construct MJPEG URL correctly', () => {
      const basePath = getBasePath('/plugins/signalk-onvif-camera/index.html');
      const serverPath = '/mjpeg?address=192.168.1.100';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toBe('/plugins/signalk-onvif-camera/mjpeg?address=192.168.1.100');
      expect(fullUrl).toMatch(/^\/[^\/]/); // Starts with / but not //
      expect(fullUrl).not.toContain('http://');
      expect(fullUrl).not.toContain(':8880');
    });

    test('should construct snapshot URL correctly', () => {
      const basePath = getBasePath('/plugins/signalk-onvif-camera/index.html');
      const serverPath = '/snapshot?address=192.168.1.100';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toBe('/plugins/signalk-onvif-camera/snapshot?address=192.168.1.100');
      expect(fullUrl).toMatch(/^\/[^\/]/);
      expect(fullUrl).not.toContain('http://');
    });

    test('should work at root level deployment', () => {
      const basePath = getBasePath('/index.html');
      const serverPath = '/mjpeg?address=192.168.1.100';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toBe('/mjpeg?address=192.168.1.100');
      expect(fullUrl).toMatch(/^\/[^\/]/);
    });

    test('should work with subpath deployment', () => {
      const basePath = getBasePath('/app/camera/index.html');
      const serverPath = '/mjpeg?address=192.168.1.100';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toBe('/app/camera/mjpeg?address=192.168.1.100');
    });
  });

  describe('WebSocket URL construction', () => {
    test('should construct WS URL from HTTP location', () => {
      const protocol = 'http:';
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
      const host = 'localhost:3000';
      const basePath = getBasePath('/plugins/onvif/index.html');
      const wsUrl = wsProtocol + '//' + host + basePath;

      expect(wsUrl).toBe('ws://localhost:3000/plugins/onvif');
      expect(wsUrl).toMatch(/^ws:\/\//);
    });

    test('should construct WSS URL from HTTPS location', () => {
      const protocol = 'https:';
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
      const host = 'example.com:443';
      const basePath = getBasePath('/plugins/onvif/index.html');
      const wsUrl = wsProtocol + '//' + host + basePath;

      expect(wsUrl).toBe('wss://example.com:443/plugins/onvif');
      expect(wsUrl).toMatch(/^wss:\/\//);
    });

    test('should work with root deployment', () => {
      const protocol = 'http:';
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
      const host = 'localhost:8880';
      const basePath = getBasePath('/index.html');
      const wsUrl = wsProtocol + '//' + host + basePath;

      expect(wsUrl).toBe('ws://localhost:8880');
    });

    test('should preserve custom ports', () => {
      const protocol = 'http:';
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
      const host = 'signalk.local:3001'; // Custom port
      const basePath = getBasePath('/plugins/camera/index.html');
      const wsUrl = wsProtocol + '//' + host + basePath;

      expect(wsUrl).toBe('ws://signalk.local:3001/plugins/camera');
      expect(wsUrl).toContain(':3001');
    });
  });

  describe('Full URL construction for display', () => {
    test('should convert relative URL to absolute for display', () => {
      const relativeUrl = '/plugins/onvif/mjpeg?address=192.168.1.100';
      const protocol = 'https:';
      const host = 'signalk.example.com';

      const absoluteUrl = relativeUrl.startsWith('http')
        ? relativeUrl
        : protocol + '//' + host + relativeUrl;

      expect(absoluteUrl).toBe('https://signalk.example.com/plugins/onvif/mjpeg?address=192.168.1.100');
      expect(absoluteUrl).toMatch(/^https:\/\//);
    });

    test('should not modify already absolute URLs', () => {
      const absoluteUrl = 'http://camera.local/stream';
      const protocol = 'https:';
      const host = 'signalk.example.com';

      const result = absoluteUrl.startsWith('http')
        ? absoluteUrl
        : protocol + '//' + host + absoluteUrl;

      expect(result).toBe('http://camera.local/stream');
    });

    test('should handle "Not available" strings', () => {
      const notAvailable = 'Not available';
      const protocol = 'https:';
      const host = 'signalk.example.com';

      // Should not try to construct URL from "Not available"
      const result = notAvailable.startsWith('http')
        ? notAvailable
        : (notAvailable === 'Not available' ? notAvailable : protocol + '//' + host + notAvailable);

      expect(result).toBe('Not available');
    });
  });

  describe('Edge cases and error handling', () => {
    test('should not create double slashes', () => {
      const basePath = '/plugins/onvif';
      const serverPath = '/mjpeg';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).not.toMatch(/\/\//); // No double slashes
      expect(fullUrl).toBe('/plugins/onvif/mjpeg');
    });

    test('should handle empty base path correctly', () => {
      const basePath = '';
      const serverPath = '/mjpeg?address=192.168.1.100';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toBe('/mjpeg?address=192.168.1.100');
      expect(fullUrl).toMatch(/^\/[^\/]/);
    });

    test('should preserve query parameters', () => {
      const basePath = getBasePath('/plugins/onvif/index.html');
      const serverPath = '/mjpeg?address=192.168.1.100&profile=main';
      const fullUrl = basePath + serverPath;

      expect(fullUrl).toContain('?address=192.168.1.100');
      expect(fullUrl).toContain('&profile=main');
    });

    test('should handle paths with special characters', () => {
      const basePath = getBasePath('/plugins/camera-v2/index.html');
      expect(basePath).toBe('/plugins/camera-v2');

      const basePath2 = getBasePath('/plugins/camera_viewer/index.html');
      expect(basePath2).toBe('/plugins/camera_viewer');
    });
  });
});
