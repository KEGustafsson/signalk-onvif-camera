/**
 * Tests for the Signal K PUT-based PTZ API.
 *
 * The plugin registers PUT handlers on `sensors.camera.ptz.{move,stop,home}`
 * via app.registerPutHandler so external plugins/apps can drive PTZ through the
 * standard Signal K PUT mechanism. These tests exercise the handlers directly
 * via the callbacks captured during plugin.start().
 */

import type { CreatePlugin, JsonRecord, MockApp, PluginLike } from './test-types';

const { EventEmitter } = require('events') as typeof import('events');

interface PutHandlerResult {
  state: 'COMPLETED' | 'PENDING' | 'FAILED';
  statusCode?: number;
  message?: string;
}

type PutHandlerCallback = (result: PutHandlerResult) => void;
type PutHandler = (context: string, path: string, value: unknown, callback: PutHandlerCallback) => PutHandlerResult;

interface MockPtzDeviceState {
  address: string;
  initialized: boolean;
  services: { ptz: { gotoHomePosition: jest.Mock } | null; events: null };
  setAuth: jest.Mock;
  init: jest.Mock;
  getCurrentProfile: jest.Mock;
  getProfile: jest.Mock;
  getProfileList: jest.Mock;
  getInformation: jest.Mock;
  changeProfile: jest.Mock;
  fetchSnapshot: jest.Mock;
  fetchSnapshotForProfile: jest.Mock;
  ptzMove: jest.Mock;
  ptzStop: jest.Mock;
}

const mockStartProbe = jest.fn<Promise<Array<{ xaddrs: string[]; name: string }>>, [string?]>().mockResolvedValue([]);
const mockStopProbe = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
const mockDeviceInstances: MockPtzDeviceState[] = [];

jest.mock('../lib/node-onvif', () => {
  const profile = {
    token: 'profile-1',
    name: 'Profile 1',
    snapshot: 'http://camera/snapshot.jpg',
    stream: { rtsp: 'rtsp://camera/stream', http: '', udp: '' },
    video: { source: null, encoder: null },
    audio: { source: null, encoder: null },
    ptz: { range: { x: { min: 0, max: 0 }, y: { min: 0, max: 0 }, z: { min: 0, max: 0 } } }
  };

  const MockOnvifDevice = function (this: MockPtzDeviceState, params: { xaddr?: string; address?: string }) {
    const xaddr = params?.xaddr || `http://${params?.address || '127.0.0.1'}/onvif/device_service`;
    this.address = new URL(xaddr).hostname;
    this.initialized = false;
    this.services = {
      ptz: { gotoHomePosition: jest.fn((_p: JsonRecord, cb: (e: Error | null, r?: JsonRecord) => void) => cb(null, {})) },
      events: null
    };
    this.setAuth = jest.fn();
    this.init = jest.fn((cb: (e: Error | null, r?: JsonRecord) => void) => {
      this.initialized = true;
      cb(null, { Manufacturer: 'Test', Model: 'Camera' });
    });
    this.getCurrentProfile = jest.fn(() => (this.initialized ? profile : null));
    this.getProfile = jest.fn(() => profile);
    this.getProfileList = jest.fn(() => [profile]);
    this.getInformation = jest.fn(() => ({ Manufacturer: 'Test', Model: 'Camera' }));
    this.changeProfile = jest.fn(() => profile);
    this.fetchSnapshot = jest.fn();
    this.fetchSnapshotForProfile = jest.fn();
    this.ptzMove = jest.fn((_params: JsonRecord, cb: (e: Error | null) => void) => cb(null));
    this.ptzStop = jest.fn((cb: (e: Error | null, r?: JsonRecord) => void) => cb(null, {}));
    mockDeviceInstances.push(this);
  };

  return {
    startProbe: (...args: Parameters<typeof mockStartProbe>) => mockStartProbe(...args),
    stopProbe: () => mockStopProbe(),
    OnvifDevice: MockOnvifDevice
  };
});

const DEVICE_ADDRESS = '192.168.1.50';

function invokePut(handler: PutHandler, value: unknown): Promise<PutHandlerResult> {
  return new Promise((resolve) => {
    const sync = handler('vessels.self', 'sensors.camera.ptz.move', value, (asyncResult) => resolve(asyncResult));
    if (sync.state !== 'PENDING') {
      resolve(sync);
    }
  });
}

describe('PTZ PUT API', () => {
  let plugin: PluginLike;
  let mockApp: MockApp;
  let putHandlers: Record<string, PutHandler>;

  async function startWithDiscoveredDevice(): Promise<void> {
    mockStartProbe.mockResolvedValue([{
      xaddrs: [`http://${DEVICE_ADDRESS}/onvif/device_service`],
      name: 'Test Camera'
    }]);
    plugin.start({
      snapshotInterval: 100,
      discoverOnStart: true,
      startupDiscoveryDelay: 0.001,
      autoDiscoveryInterval: 0
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  beforeEach(() => {
    jest.resetModules();
    putHandlers = {};
    mockStartProbe.mockReset();
    mockStartProbe.mockResolvedValue([]);
    mockStopProbe.mockReset();
    mockStopProbe.mockResolvedValue(undefined);
    mockDeviceInstances.length = 0;

    const mockServer = new EventEmitter();
    mockApp = {
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
      registerPutHandler: jest.fn((_context: string, path: string, handler: PutHandler) => {
        putHandlers[path] = handler;
      }),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index') as CreatePlugin;
    plugin = createPlugin(mockApp);
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_error) { /* ignore */ }
  });

  describe('handler registration', () => {
    test('registers move, stop and home PUT handlers on vessels.self', () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });

      const paths = (mockApp.registerPutHandler!.mock.calls as Array<[string, string, unknown, unknown]>)
        .map((call) => ({ context: call[0], path: call[1] }));

      expect(paths).toContainEqual({ context: 'vessels.self', path: 'sensors.camera.ptz.move' });
      expect(paths).toContainEqual({ context: 'vessels.self', path: 'sensors.camera.ptz.stop' });
      expect(paths).toContainEqual({ context: 'vessels.self', path: 'sensors.camera.ptz.home' });
    });

    test('re-registers handlers after a restart (Signal K removes them on stop)', () => {
      // Signal K deregisters a plugin's PUT handlers when it stops, so the
      // handlers must be registered again on every start() — otherwise the PTZ
      // paths would have no handler after a config-change restart.
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const countAfterFirst = mockApp.registerPutHandler!.mock.calls.length;
      expect(countAfterFirst).toBe(3);
      plugin.stop();
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      expect(mockApp.registerPutHandler!.mock.calls.length).toBe(countAfterFirst + 3);
    });

    test('does not throw when app.registerPutHandler is unavailable', () => {
      delete mockApp.registerPutHandler;
      expect(() => plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 })).not.toThrow();
    });
  });

  describe('move', () => {
    test('auto-connects and issues a continuous move', async () => {
      await startWithDiscoveredDevice();

      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], {
        address: DEVICE_ADDRESS,
        speed: { x: 0.5, y: 0, z: 0 }
      });

      expect(result.statusCode).toBe(200);
      expect(result.state).toBe('COMPLETED');
      const device = mockDeviceInstances[0];
      expect(device.setAuth).toHaveBeenCalled();
      expect(device.init).toHaveBeenCalled();
      expect(device.ptzMove).toHaveBeenCalledWith(
        expect.objectContaining({ address: DEVICE_ADDRESS, speed: { x: 0.5, y: 0, z: 0 } }),
        expect.any(Function)
      );
    });

    test('does not re-connect a device that is already connected', async () => {
      await startWithDiscoveredDevice();
      // First move connects the device
      await invokePut(putHandlers['sensors.camera.ptz.move'], { address: DEVICE_ADDRESS, speed: { x: 0.1, y: 0, z: 0 } });
      const device = mockDeviceInstances[0];
      device.init.mockClear();

      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: DEVICE_ADDRESS, speed: { x: 0.2, y: 0, z: 0 } });

      expect(result.statusCode).toBe(200);
      expect(device.init).not.toHaveBeenCalled();
    });

    test('returns 400 for an invalid address', async () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: 'not-an-ip', speed: { x: 0.5, y: 0, z: 0 } });
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 for an out-of-range speed', async () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: DEVICE_ADDRESS, speed: { x: 5, y: 0, z: 0 } });
      expect(result.statusCode).toBe(400);
    });

    test('returns 404 when the device has not been discovered', async () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: '10.9.9.9', speed: { x: 0.5, y: 0, z: 0 } });
      expect(result.statusCode).toBe(404);
    });

    test('returns 405 when the device does not support PTZ', async () => {
      await startWithDiscoveredDevice();
      mockDeviceInstances[0].services.ptz = null;

      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: DEVICE_ADDRESS, speed: { x: 0.5, y: 0, z: 0 } });
      expect(result.statusCode).toBe(405);
    });

    test('returns 502 when the ONVIF move command fails', async () => {
      await startWithDiscoveredDevice();
      mockDeviceInstances[0].ptzMove.mockImplementationOnce((_p: JsonRecord, cb: (e: Error | null) => void) => cb(new Error('camera offline')));

      const result = await invokePut(putHandlers['sensors.camera.ptz.move'], { address: DEVICE_ADDRESS, speed: { x: 0.5, y: 0, z: 0 } });
      expect(result.statusCode).toBe(502);
      expect(result.message).toContain('camera offline');
    });
  });

  describe('stop', () => {
    test('stops PTZ movement', async () => {
      await startWithDiscoveredDevice();
      const result = await invokePut(putHandlers['sensors.camera.ptz.stop'], { address: DEVICE_ADDRESS });
      expect(result.statusCode).toBe(200);
      expect(mockDeviceInstances[0].ptzStop).toHaveBeenCalled();
    });

    test('accepts a bare address string value', async () => {
      await startWithDiscoveredDevice();
      const result = await invokePut(putHandlers['sensors.camera.ptz.stop'], DEVICE_ADDRESS);
      expect(result.statusCode).toBe(200);
      expect(mockDeviceInstances[0].ptzStop).toHaveBeenCalled();
    });

    test('returns 400 when the address is missing', async () => {
      plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
      const result = await invokePut(putHandlers['sensors.camera.ptz.stop'], {});
      expect(result.statusCode).toBe(400);
    });
  });

  describe('home', () => {
    test('sends the camera to its home position with the requested speed', async () => {
      await startWithDiscoveredDevice();
      const result = await invokePut(putHandlers['sensors.camera.ptz.home'], { address: DEVICE_ADDRESS, speed: 0.5 });
      expect(result.statusCode).toBe(200);
      const ptz = mockDeviceInstances[0].services.ptz;
      expect(ptz).not.toBeNull();
      expect(ptz!.gotoHomePosition).toHaveBeenCalledWith(
        expect.objectContaining({ ProfileToken: 'profile-1', Speed: 0.5 }),
        expect.any(Function)
      );
    });

    test('defaults the speed to 1 when unspecified', async () => {
      await startWithDiscoveredDevice();
      await invokePut(putHandlers['sensors.camera.ptz.home'], { address: DEVICE_ADDRESS });
      const ptz = mockDeviceInstances[0].services.ptz;
      expect(ptz!.gotoHomePosition).toHaveBeenCalledWith(
        expect.objectContaining({ Speed: 1 }),
        expect.any(Function)
      );
    });

    test('returns 405 when the device does not support PTZ', async () => {
      await startWithDiscoveredDevice();
      mockDeviceInstances[0].services.ptz = null;
      const result = await invokePut(putHandlers['sensors.camera.ptz.home'], { address: DEVICE_ADDRESS });
      expect(result.statusCode).toBe(405);
    });
  });
});
