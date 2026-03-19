/**
 * Tests for HTTP endpoint handlers (mjpeg, snapshot, api/streams, api/profiles)
 *
 * These handlers are registered on SignalK's Express app and are tested by
 * exercising them directly via the route callbacks captured during plugin.start().
 */

const EventEmitter = require('events');

let mockConnectionHandler: ((socket: unknown) => void) | null = null;
const mockWsClose = jest.fn();

jest.mock('ws', () => {
  const mockWsServer = jest.fn().mockImplementation(function () {
    this.on = jest.fn((event, handler) => {
      if (event === 'connection') mockConnectionHandler = handler;
    });
    this.close = mockWsClose;
    this.handleUpgrade = jest.fn((req, socket, head, cb) => { cb(socket); });
    this.emit = jest.fn();
  });
  return { Server: mockWsServer, OPEN: 1 };
});

jest.mock('../lib/node-onvif', () => {
  function buildProfiles(address) {
    return [{
      token: `${address}-profile`,
      name: `Profile for ${address}`,
      stream: {
        rtsp: `rtsp://${address}/stream`,
        http: `http://${address}/stream`,
        udp: `udp://${address}/stream`
      },
      snapshot: `http://${address}/snapshot`,
      video: {
        encoder: {
          resolution: { width: 1920, height: 1080 },
          framerate: 25,
          encoding: 'H264'
        }
      },
      audio: null
    }];
  }

  function MockOnvifDevice(params) {
    this.address = new URL(params.xaddr).hostname;
    this.services = { ptz: null, events: null };
    this._profiles = buildProfiles(this.address);
    this._currentProfile = this._profiles[0];
    this.setAuth = jest.fn();
    this.init = jest.fn((cb) => cb(null, { Manufacturer: 'MockCam', Model: this.address }));
    this.changeProfile = jest.fn((token) => {
      const matchedProfile = this._profiles.find((profile) => profile.token === token) || null;
      if (matchedProfile) {
        this._currentProfile = matchedProfile;
      }
      return matchedProfile;
    });
    this.getCurrentProfile = jest.fn(() => this._currentProfile);
    this.getProfileList = jest.fn(() => this._profiles);
    this.getInformation = jest.fn(() => ({ Manufacturer: 'MockCam', Model: this.address }));
    this.fetchSnapshot = jest.fn((cb) => {
      if (this.address === '10.0.0.12') {
        cb(new Error('camera offline'));
        return;
      }
      if (this.address === '10.0.0.13') {
        cb(null, {});
        return;
      }
      cb(null, {
        headers: { 'content-type': 'image/png' },
        body: Buffer.from('img')
      });
    });
  }

  return {
    OnvifDevice: MockOnvifDevice,
    startProbe: jest.fn().mockResolvedValue([
      { xaddrs: ['http://10.0.0.11/onvif/device_service'], name: 'Snapshot OK', urn: 'urn:uuid:snapshot-ok' },
      { xaddrs: ['http://10.0.0.12/onvif/device_service'], name: 'Snapshot Error', urn: 'urn:uuid:snapshot-error' },
      { xaddrs: ['http://10.0.0.13/onvif/device_service'], name: 'Snapshot Empty', urn: 'urn:uuid:snapshot-empty' }
    ])
  };
});

function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead: jest.fn(function (status, headers: Record<string, unknown> = {}) {
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

function makeReq(query: Record<string, string> = {}) {
  const req = new EventEmitter();
  req.query = query;
  req.url = '/?' + Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&');
  return req;
}

function makeSocket() {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.send = jest.fn();
  return socket;
}

describe('HTTP endpoint handlers', () => {
  let plugin;
  let routes: Record<string, (req: unknown, res: ReturnType<typeof makeRes>) => void>;
  let mockApp;

  beforeEach(async () => {
    jest.resetModules();
    mockConnectionHandler = null;
    mockWsClose.mockReset();
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

    const createPlugin = require('../index');
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });

    const socket = makeSocket();
    if (!mockConnectionHandler) {
      throw new Error('Expected HTTP endpoint test WebSocket connection handler');
    }
    (mockConnectionHandler as (socket: unknown) => void)(socket);
    socket.emit('message', JSON.stringify({ method: 'startDiscovery', params: {} }));
    await new Promise((resolve) => setTimeout(resolve, 10));
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

    test('should return 200 with image data when device exists', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.11' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/png',
        'Content-Length': 3,
        'Cache-Control': 'no-cache'
      });
      expect(res.end).toHaveBeenCalledWith(Buffer.from('img'));
    });

    test('should return 500 on snapshot fetch error', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.12' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Failed to fetch snapshot: camera offline');
    });

    test('should return 502 when snapshot returns no data', () => {
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.13' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Snapshot returned no data');
    });
  });

  // ── /api/streams ─────────────────────────────────────────────────────────────

  describe('GET /plugins/signalk-onvif-camera/api/streams', () => {
    const path = '/plugins/signalk-onvif-camera/api/streams';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const body = JSON.parse(String(res.end.mock.calls[0][0]));
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
      const body = JSON.parse(String(res.end.mock.calls[0][0]));
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
