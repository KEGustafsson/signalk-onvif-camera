/**
 * Tests for HTTP endpoint handlers (mjpeg, snapshot, api/streams, api/profiles)
 *
 * These handlers are registered on SignalK's Express app and are tested by
 * exercising them directly via the route callbacks captured during plugin.start().
 */

import type { CreatePlugin, JsonRecord, MockApp, PluginLike } from './test-types';

const { EventEmitter } = require('events') as typeof import('events');

interface MockSnapshotResponse {
  body?: Buffer;
  headers?: {
    'content-type'?: string;
  };
}

type SnapshotCallback = (error: Error | null, result?: MockSnapshotResponse) => void;

const mockStartProbe = jest.fn<Promise<Array<{ xaddrs: string[]; name: string }>>, [string?]>().mockResolvedValue([]);
const mockFetchSnapshot = jest.fn<void, [SnapshotCallback]>();
const mockStopProbe = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
const mockDeviceInstances: MockOnvifDeviceState[] = [];

interface MockOnvifDeviceState {
  address: string;
  changeProfile: jest.Mock;
  fetchSnapshot: typeof mockFetchSnapshot;
  fetchSnapshotForProfile: jest.Mock;
  setAuth: jest.Mock;
  init: jest.Mock;
  getCurrentProfile: jest.Mock;
  getProfile: jest.Mock;
  getProfileList: jest.Mock;
  getInformation: jest.Mock;
  services: {
    ptz: null;
    events: null;
  };
}

jest.mock('../lib/node-onvif', () => {
  const defaultProfile = {
    token: 'profile-1',
    name: 'Profile 1',
    snapshot: 'http://camera/snapshot.jpg',
    stream: {
      rtsp: 'rtsp://camera/stream',
      http: 'http://camera/stream',
      udp: 'udp://camera/stream'
    },
    video: {
      source: null,
      encoder: null
    },
    audio: {
      source: null,
      encoder: null
    },
    ptz: {
      range: {
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
        z: { min: 0, max: 0 }
      }
    }
  };

  const MockOnvifDevice = function (this: MockOnvifDeviceState, params: { xaddr?: string; address?: string }) {
    const xaddr = params?.xaddr || `http://${params?.address || '127.0.0.1'}/onvif/device_service`;
    this.address = new URL(xaddr).hostname;
    this.changeProfile = jest.fn(() => defaultProfile);
    this.fetchSnapshot = mockFetchSnapshot;
    this.fetchSnapshotForProfile = jest.fn((_profile: string | number, callback: SnapshotCallback) => {
      mockFetchSnapshot(callback);
    });
    this.setAuth = jest.fn();
    this.init = jest.fn((callback: (error: Error | null, result?: { Manufacturer: string; Model: string }) => void) => {
      callback(null, { Manufacturer: 'Test', Model: 'Camera' });
    });
    this.getCurrentProfile = jest.fn(() => defaultProfile);
    this.getProfile = jest.fn((profile: string | number) => profile === 'missing-profile' ? null : defaultProfile);
    this.getProfileList = jest.fn(() => [defaultProfile]);
    this.getInformation = jest.fn(() => ({ Manufacturer: 'Test', Model: 'Camera' }));
    this.services = {
      ptz: null,
      events: null
    };
    mockDeviceInstances.push(this);
  };

  return {
    startProbe: (...args: Parameters<typeof mockStartProbe>) => mockStartProbe(...args),
    stopProbe: () => mockStopProbe(),
    OnvifDevice: MockOnvifDevice
  };
});

interface MockResponse {
  _status: number | null;
  _headers: Record<string, unknown>;
  _body: unknown;
  _ended: boolean;
  writeHead: jest.Mock<void, [number, Record<string, unknown>]>;
  write: jest.Mock;
  end: jest.Mock<void, [unknown?]>;
  flushHeaders: jest.Mock;
  socket: {
    setNoDelay: jest.Mock;
  };
}

interface MockRequest extends InstanceType<typeof EventEmitter> {
  query: Record<string, string>;
  url: string;
}

type RouteHandler = (req: MockRequest, res: MockResponse) => void;

function makeRes(): MockResponse {
  return {
    _status: null,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead: jest.fn(function (this: MockResponse, status: number, headers: Record<string, unknown>) {
      this._status = status;
      this._headers = { ...this._headers, ...headers };
    }),
    write: jest.fn(),
    end: jest.fn(function (this: MockResponse, body?: unknown) {
      this._body = body;
      this._ended = true;
    }),
    flushHeaders: jest.fn(),
    socket: { setNoDelay: jest.fn() }
  };
}

function makeReq(query: Record<string, string> = {}): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.query = query;
  req.url = '/?' + Object.entries(query).map(([key, value]) => `${key}=${value}`).join('&');
  return req;
}

describe('HTTP endpoint handlers', () => {
  let plugin: PluginLike;
  let routes: Record<string, RouteHandler>;
  let mockApp: MockApp;

  beforeEach(() => {
    jest.resetModules();
    routes = {};
    mockStartProbe.mockReset();
    mockStartProbe.mockResolvedValue([]);
    mockFetchSnapshot.mockReset();
    mockStopProbe.mockReset();
    mockStopProbe.mockResolvedValue(undefined);
    mockDeviceInstances.length = 0;

    const mockServer = new EventEmitter();
    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn((path: string, handler: RouteHandler) => {
        routes[path] = handler;
      }),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index') as CreatePlugin;
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_error) {}
  });

  async function restartWithDiscoveredDevice(address: string, fetchSnapshotImpl: (callback: SnapshotCallback) => void): Promise<void> {
    plugin.stop();
    mockStartProbe.mockResolvedValue([{
      xaddrs: [`http://${address}/onvif/device_service`],
      name: 'Discovered Camera'
    }]);
    mockFetchSnapshot.mockImplementation(fetchSnapshotImpl);
    plugin.start({
      snapshotInterval: 100,
      discoverOnStart: true,
      startupDiscoveryDelay: 0.001,
      autoDiscoveryInterval: 0
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  describe('authorization', () => {
    test('should return 401 on all endpoints when securityStrategy rejects', () => {
      mockApp.securityStrategy = {
        shouldAllowRequest: jest.fn<boolean, [unknown, unknown?]>(() => false)
      };

      const endpoints = [
        '/plugins/signalk-onvif-camera/mjpeg',
        '/plugins/signalk-onvif-camera/snapshot',
        '/plugins/signalk-onvif-camera/api/streams',
        '/plugins/signalk-onvif-camera/api/profiles'
      ];

      for (const endpoint of endpoints) {
        const res = makeRes();
        routes[endpoint](makeReq({ address: '10.0.0.1' }), res);
        expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        expect(res.end).toHaveBeenCalledWith('Unauthorized');
      }
    });

    test('should allow requests when securityStrategy approves', () => {
      mockApp.securityStrategy = {
        shouldAllowRequest: jest.fn<boolean, [unknown, unknown?]>(() => true)
      };

      const res = makeRes();
      routes['/plugins/signalk-onvif-camera/mjpeg'](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    test('should allow requests when no securityStrategy is installed', () => {
      const res = makeRes();
      routes['/plugins/signalk-onvif-camera/mjpeg'](makeReq({}), res);
      expect(res.writeHead).not.toHaveBeenCalledWith(401, expect.any(Object));
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /plugins/signalk-onvif-camera/mjpeg', () => {
    const path = '/plugins/signalk-onvif-camera/mjpeg';

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
      routes[path](makeReq({ address: '10.0.0.1' }), res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Device not found or not connected');
    });

    test('should stream frames using the snapshot content type', async () => {
      const body = Buffer.from('png-frame-data');
      await restartWithDiscoveredDevice('10.0.0.21', (callback) => {
        callback(null, {
          body,
          headers: {
            'content-type': 'image/png'
          }
        });
      });

      const res = makeRes();
      const req = makeReq({ address: '10.0.0.21' });
      routes[path](req, res);
      req.emit('close');

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': expect.stringContaining('multipart/x-mixed-replace')
      }));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('Content-Type: image/png'));
      expect(res.write).toHaveBeenCalledWith(body);
    });

    test('should return 404 when requested profile is not found', async () => {
      await restartWithDiscoveredDevice('10.0.0.21', (_callback) => undefined);
      const device = mockDeviceInstances[0];
      device.getProfile.mockReturnValueOnce(null);

      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.21', profile: 'missing-profile' }), res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Profile not found: missing-profile');
    });

    test('should fetch a requested profile without mutating the device profile', async () => {
      const body = Buffer.from('profile-frame-data');
      await restartWithDiscoveredDevice('10.0.0.25', (callback) => {
        callback(null, {
          body,
          headers: {
            'content-type': 'image/jpeg'
          }
        });
      });

      const device = mockDeviceInstances[0];
      const req = makeReq({ address: '10.0.0.25', profile: 'profile-1' });
      const res = makeRes();

      routes[path](req, res);
      req.emit('close');

      expect(device.fetchSnapshotForProfile).toHaveBeenCalledWith('profile-1', expect.any(Function));
      expect(device.changeProfile).not.toHaveBeenCalled();
    });
  });

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

    test('should return 200 with image data when device exists', async () => {
      const body = Buffer.from('png-image-data');
      await restartWithDiscoveredDevice('10.0.0.2', (callback) => {
        callback(null, {
          body,
          headers: {
            'content-type': 'image/png'
          }
        });
      });

      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.2' }), res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'image/png',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache'
      }));
      expect(res.end).toHaveBeenCalledWith(body);
    });

    test('should return 500 on snapshot fetch error', async () => {
      await restartWithDiscoveredDevice('10.0.0.2', (callback) => {
        callback(new Error('camera offline'));
      });

      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.2' }), res);

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Failed to fetch snapshot: camera offline');
    });

    test('should return 502 when snapshot returns no data', async () => {
      await restartWithDiscoveredDevice('10.0.0.2', (callback) => {
        callback(null, { headers: { 'content-type': 'image/jpeg' } });
      });

      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.2' }), res);

      expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Snapshot returned no data');
    });

    test('should return 404 when requested profile is not found', async () => {
      await restartWithDiscoveredDevice('10.0.0.2', (_callback) => undefined);
      const device = mockDeviceInstances[0];
      device.getProfile.mockReturnValueOnce(null);

      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.2', profile: 'missing-profile' }), res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith('Profile not found: missing-profile');
    });

    test('should fetch a requested profile without mutating the device profile', async () => {
      const body = Buffer.from('profile-image-data');
      await restartWithDiscoveredDevice('10.0.0.26', (callback) => {
        callback(null, {
          body,
          headers: {
            'content-type': 'image/jpeg'
          }
        });
      });

      const device = mockDeviceInstances[0];
      const res = makeRes();
      routes[path](makeReq({ address: '10.0.0.26', profile: 'profile-1' }), res);

      expect(device.fetchSnapshotForProfile).toHaveBeenCalledWith('profile-1', expect.any(Function));
      expect(device.changeProfile).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledWith(body);
    });
  });

  describe('GET /plugins/signalk-onvif-camera/api/streams', () => {
    const path = '/plugins/signalk-onvif-camera/api/streams';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const body = JSON.parse(String((res.end.mock.calls as Array<[string]>)[0][0])) as JsonRecord;
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

  describe('GET /plugins/signalk-onvif-camera/api/profiles', () => {
    const path = '/plugins/signalk-onvif-camera/api/profiles';

    test('should return 400 when address is missing', () => {
      const res = makeRes();
      routes[path](makeReq({}), res);
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const body = JSON.parse(String((res.end.mock.calls as Array<[string]>)[0][0])) as JsonRecord;
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

  describe('shutdown cleanup', () => {
    test('should stop any active discovery probe on plugin.stop()', () => {
      plugin.stop();
      expect(mockStopProbe).toHaveBeenCalled();
    });

    test('should close active mjpeg responses on plugin.stop()', async () => {
      await restartWithDiscoveredDevice('10.0.0.21', (_callback) => undefined);

      const res = makeRes();
      const req = makeReq({ address: '10.0.0.21' });
      routes['/plugins/signalk-onvif-camera/mjpeg'](req, res);

      plugin.stop();

      expect(res.end).toHaveBeenCalled();
    });
  });
});
