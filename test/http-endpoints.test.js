/**
 * Tests for HTTP endpoint handlers (mjpeg, snapshot, api/streams, api/profiles)
 *
 * These handlers are registered on SignalK's Express app and are tested by
 * exercising them directly via the route callbacks captured during plugin.start().
 */

const EventEmitter = require('events');

function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead: jest.fn(function (status, headers) {
      this._status = status;
      this._headers = { ...this._headers, ...headers };
    }),
    write: jest.fn(),
    end: jest.fn(function (body) {
      this._body = body;
      this._ended = true;
    }),
    flushHeaders: jest.fn(),
    socket: { setNoDelay: jest.fn() }
  };
  return res;
}

function makeReq(query = {}) {
  const req = new EventEmitter();
  req.query = query;
  req.url = '/?' + Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&');
  return req;
}

describe('HTTP endpoint handlers', () => {
  let plugin;
  let routes;
  let mockApp;

  beforeEach(() => {
    jest.resetModules();
    routes = {};

    const mockServer = new EventEmitter();

    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn((path, handler) => { routes[path] = handler; }),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index.js');
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_) {}
  });

  // ── auth helper ─────────────────────────────────────────────────────────────

  describe('authorization', () => {
    test('should return 401 on all endpoints when securityStrategy rejects', () => {
      // Attach a security strategy that always denies
      mockApp.securityStrategy = {
        shouldAllowRequest: jest.fn(() => false)
      };

      const endpoints = [
        '/plugins/signalk-onvif-camera/mjpeg',
        '/plugins/signalk-onvif-camera/snapshot',
        '/plugins/signalk-onvif-camera/api/streams',
        '/plugins/signalk-onvif-camera/api/profiles'
      ];

      for (const ep of endpoints) {
        const res = makeRes();
        routes[ep](makeReq({ address: '10.0.0.1' }), res);
        expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        expect(res.end).toHaveBeenCalledWith('Unauthorized');
      }
    });

    test('should allow requests when securityStrategy approves', () => {
      mockApp.securityStrategy = {
        shouldAllowRequest: jest.fn(() => true)
      };

      const res = makeRes();
      routes['/plugins/signalk-onvif-camera/mjpeg'](makeReq({}), res);
      // Missing address → 400, but NOT 401 — auth passed
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should allow requests when no securityStrategy is installed', () => {
      // mockApp has no securityStrategy — open/dev mode
      const res = makeRes();
      routes['/plugins/signalk-onvif-camera/mjpeg'](makeReq({}), res);
      expect(res.writeHead).not.toHaveBeenCalledWith(401, expect.any(Object));
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  // ── /mjpeg ──────────────────────────────────────────────────────────────────

  describe('GET /plugins/signalk-onvif-camera/mjpeg', () => {
    const path = '/plugins/signalk-onvif-camera/mjpeg';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      const req = makeReq({});
      routes[path](req, res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Missing address parameter');
    });

    test('should return 400 for malformed address', () => {
      const res = makeRes();
      routes[path](makeReq({ address: 'not-an-ip' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should return 404 when device is not found', () => {
      const res = makeRes();
      const req = makeReq({ address: '10.0.0.1' });
      routes[path](req, res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Device not found or not connected');
    });
  });

  // ── /snapshot ───────────────────────────────────────────────────────────────

  describe('GET /plugins/signalk-onvif-camera/snapshot', () => {
    const path = '/plugins/signalk-onvif-camera/snapshot';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Missing address parameter');
    });

    test('should return 400 for malformed address', () => {
      const res = makeRes();
      routes[path](makeReq({ address: 'not-an-ip' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should return 404 when device is not found', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.2' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });

    // Device injection requires a WS discovery round-trip not available in this
    // unit-test harness (the internal device map is not exposed). These paths
    // are covered by integration tests; mark as todo so the suite stays honest.
    test.todo('should return 200 with image data when device exists');
    test.todo('should return 500 on snapshot fetch error');
    test.todo('should return 502 when snapshot returns no data');
  });

  // ── /api/streams ─────────────────────────────────────────────────────────────

  describe('GET /plugins/signalk-onvif-camera/api/streams', () => {
    const path = '/plugins/signalk-onvif-camera/api/streams';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.error).toBeDefined();
    });

    test('should return 400 for malformed address', () => {
      const res = makeRes();
      routes[path](makeReq({ address: 'not-an-ip' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should return 404 when device not found', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.3' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  // ── /api/profiles ─────────────────────────────────────────────────────────

  describe('GET /plugins/signalk-onvif-camera/api/profiles', () => {
    const path = '/plugins/signalk-onvif-camera/api/profiles';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.error).toBeDefined();
    });

    test('should return 400 for malformed address', () => {
      const res = makeRes();
      routes[path](makeReq({ address: 'not-an-ip' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should return 404 when device not found', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.4' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  // ── route registration ───────────────────────────────────────────────────────

  describe('route registration', () => {
    test('all four plugin routes must be registered', () => {
      expect(routes['/plugins/signalk-onvif-camera/mjpeg']).toBeInstanceOf(Function);
      expect(routes['/plugins/signalk-onvif-camera/snapshot']).toBeInstanceOf(Function);
      expect(routes['/plugins/signalk-onvif-camera/api/streams']).toBeInstanceOf(Function);
      expect(routes['/plugins/signalk-onvif-camera/api/profiles']).toBeInstanceOf(Function);
    });

    test('routes should not be re-registered on plugin restart', () => {
      const callCountAfterFirst = mockApp.get.mock.calls.length;
      plugin.stop();
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      expect(mockApp.get.mock.calls.length).toBe(callCountAfterFirst);
    });
  });
});
