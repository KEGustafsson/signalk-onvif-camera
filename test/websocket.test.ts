/**
 * Tests for WebSocket message handling and handler dispatch
 *
 * The plugin attaches a ws.Server to app.server. We mock ws at module level,
 * capture the 'connection' handler, and exercise all message-dispatch paths.
 */

import type { ConnectionHandler, CreatePlugin, JsonRecord, MockApp, MockSocket, PluginLike } from './test-types';

const { EventEmitter } = require('events') as typeof import('events');

type MockServerEmitter = InstanceType<typeof EventEmitter>;

let mockConnectionHandler: ConnectionHandler | null = null;
const mockWsClose = jest.fn();
const mockStartProbe = jest.fn<Promise<Array<{ xaddrs: string[]; name: string }>>, [string?]>().mockResolvedValue([]);
const mockStopProbe = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
const mockDeviceInstances: MockOnvifDeviceState[] = [];
const mockOnvifModule = {
  startProbe: (...args: Parameters<typeof mockStartProbe>) => mockStartProbe(...args),
  stopProbe: () => mockStopProbe(),
  OnvifDevice: null as unknown,
  _probeInProgress: false
};

interface MockOnvifDeviceState {
  address: string;
  services: {
    ptz: null;
    events: null;
  };
  setAuth: jest.Mock;
  init: jest.Mock;
  getCurrentProfile: jest.Mock;
  getProfile: jest.Mock;
  getProfileList: jest.Mock;
  changeProfile: jest.Mock;
  fetchSnapshot: jest.Mock;
  fetchSnapshotForProfile: jest.Mock;
  ptzMove: jest.Mock;
  ptzStop: jest.Mock;
  getInformation: jest.Mock;
}

jest.mock('ws', () => {
  class MockWsServer {
    public on = jest.fn((event: string, handler: ConnectionHandler) => {
      if (event === 'connection') {
        mockConnectionHandler = handler;
      }
    });
    public close = mockWsClose;
    public handleUpgrade = jest.fn((_req: unknown, socket: MockSocket, _head: unknown, cb: (socket: MockSocket) => void) => {
      cb(socket);
    });
    public emit = jest.fn();
  }

  return {
    Server: jest.fn(() => new MockWsServer()),
    OPEN: 1
  };
});

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
    if (!params?.xaddr && !params?.address) {
      throw new Error('No device service address was provided.');
    }
    const xaddr = params?.xaddr || `http://${params?.address || '127.0.0.1'}/onvif/device_service`;
    this.address = new URL(xaddr).hostname;
    this.services = {
      ptz: null,
      events: null
    };
    this.setAuth = jest.fn();
    this.init = jest.fn((callback: (error: Error | null, result?: JsonRecord | null) => void) => {
      callback(null, {
        Manufacturer: 'Test',
        Model: 'Camera'
      });
    });
    this.getCurrentProfile = jest.fn(() => defaultProfile);
    this.getProfile = jest.fn((profile: string | number) => profile === 'missing-profile' ? null : defaultProfile);
    this.getProfileList = jest.fn(() => [defaultProfile]);
    this.changeProfile = jest.fn((profile: string | number) => profile === 'missing-profile' ? null : defaultProfile);
    this.fetchSnapshot = jest.fn((callback: (error: Error | null, result?: { body: Buffer; headers: { 'content-type': string } }) => void) => {
      callback(null, {
        body: Buffer.from('frame-data'),
        headers: {
          'content-type': 'image/jpeg'
        }
      });
    });
    this.fetchSnapshotForProfile = jest.fn((_profile: string | number, callback: (error: Error | null, result?: { body: Buffer; headers: { 'content-type': string } }) => void) => {
      this.fetchSnapshot(callback);
    });
    this.ptzMove = jest.fn((params: JsonRecord, callback: (error: Error | null) => void) => callback(null));
    this.ptzStop = jest.fn((callback: (error: Error | null, result?: JsonRecord) => void) => callback(null, {}));
    this.getInformation = jest.fn(() => ({
      Manufacturer: 'Test',
      Model: 'Camera'
    }));
    mockDeviceInstances.push(this);
  };

  mockOnvifModule.OnvifDevice = MockOnvifDevice;
  return mockOnvifModule;
});

function makeSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.readyState = 1;
  socket.send = jest.fn();
  socket.close = jest.fn();
  socket.terminate = jest.fn();
  return socket;
}

function connectSocket(request: JsonRecord = { url: '/plugins/signalk-onvif-camera/ws' }): MockSocket {
  const socket = makeSocket();
  const handler = mockConnectionHandler;
  if(!handler) {
    throw new Error('WebSocket connection handler was not registered');
  }
  handler(socket, request);
  return socket;
}

function sendMessage(socket: MockSocket, obj: JsonRecord): void {
  socket.emit('message', JSON.stringify(obj));
}

function lastSent(socket: MockSocket): JsonRecord {
  const calls = socket.send.mock.calls as Array<[string]>;
  return JSON.parse(calls[calls.length - 1][0]) as JsonRecord;
}

describe('WebSocket message handling', () => {
  let plugin: PluginLike;
  let mockApp: MockApp;
  let mockServer: MockServerEmitter;

  beforeEach(() => {
    jest.resetModules();
    mockConnectionHandler = null;
    mockWsClose.mockReset();
    mockStartProbe.mockReset();
    mockStartProbe.mockResolvedValue([]);
    mockStopProbe.mockReset();
    mockStopProbe.mockResolvedValue(undefined);
    mockOnvifModule._probeInProgress = false;
    mockDeviceInstances.length = 0;

    mockServer = new EventEmitter();
    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
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

  test('should create ws.Server in noServer mode', () => {
    const WS = require('ws') as { Server: jest.Mock };
    expect(WS.Server).toHaveBeenCalledWith(
      expect.objectContaining({ noServer: true })
    );
  });

  test('should register a connection handler on ws.Server', () => {
    expect(mockConnectionHandler).toBeInstanceOf(Function);
  });

  test('should reject unauthorized websocket upgrades before connection', () => {
    const WS = require('ws') as { Server: jest.Mock };
    const serverInstance = WS.Server.mock.results[0].value as {
      handleUpgrade: jest.Mock;
    };
    const socket = {
      write: jest.fn(),
      destroy: jest.fn()
    };

    const securityStrategy = {
      shouldAllowRequest: jest.fn<boolean, [unknown, unknown?]>(() => false)
    };
    mockApp.securityStrategy = securityStrategy;
    mockServer.emit('upgrade', { url: '/plugins/signalk-onvif-camera/ws' }, socket, Buffer.alloc(0));

    expect(securityStrategy.shouldAllowRequest).toHaveBeenCalled();
    expect(serverInstance.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    expect(socket.destroy).toHaveBeenCalled();
  });

  test('should reject PTZ commands when websocket request lacks WRITE permission', async () => {
    mockApp.securityStrategy = {
      shouldAllowRequest: jest.fn<boolean, [unknown, unknown?]>((_request, permission) => permission === 'READ')
    };

    const socket = connectSocket();
    sendMessage(socket, {
      method: 'ptzMove',
      params: { address: '10.0.0.5', speed: { x: 0.5, y: 0, z: 0 }, timeout: 10 }
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(mockApp.securityStrategy.shouldAllowRequest).toHaveBeenCalledWith(expect.anything(), 'WRITE');
    expect(lastSent(socket)).toEqual({
      id: 'ptzMove',
      error: 'Unauthorized'
    });
  });

  test('should reject connect when websocket request lacks WRITE permission', async () => {
    mockApp.securityStrategy = {
      shouldAllowRequest: jest.fn<boolean, [unknown, unknown?]>((_request, permission) => permission === 'READ')
    };

    const socket = connectSocket();
    sendMessage(socket, {
      method: 'connect',
      params: { address: '10.0.0.20' }
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(mockApp.securityStrategy.shouldAllowRequest).toHaveBeenCalledWith(expect.anything(), 'WRITE');
    expect(lastSent(socket)).toEqual({
      id: 'connect',
      error: 'Unauthorized'
    });
  });

  describe('invalid JSON', () => {
    test('should send error response for malformed message', () => {
      const socket = connectSocket();
      socket.emit('message', '{bad-json}');
      expect(socket.send).toHaveBeenCalledTimes(1);
      expect(lastSent(socket).error).toBeDefined();
    });

    test('should not send when socket is not OPEN', () => {
      const socket = connectSocket();
      socket.readyState = 3;
      socket.emit('message', 'not-json');
      expect(socket.send).not.toHaveBeenCalled();
    });

    test('should respond with error for unknown method', () => {
      const socket = connectSocket();
      socket.emit('message', JSON.stringify({ method: 'nonExistentMethod', params: {} }));
      expect(socket.send).toHaveBeenCalled();
      expect(String(lastSent(socket).error || '')).toMatch(/Unknown method/);
    });

    test('should not throw when params field is absent from message', async () => {
      const socket = connectSocket();
      expect(() =>
        socket.emit('message', JSON.stringify({ method: 'connect' }))
      ).not.toThrow();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(socket.send).toHaveBeenCalled();
      expect(lastSent(socket).error).toBeDefined();
    });
  });

  describe('ping', () => {
    test('responds with pong for heartbeat requests', () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'ping' });
      expect(lastSent(socket)).toEqual({
        id: 'ping',
        result: 'pong'
      });
    });
  });

  describe('socket lifecycle', () => {
    test('close event should not throw', () => {
      const socket = connectSocket();
      expect(() => socket.emit('close')).not.toThrow();
    });

    test('error event should log but not throw', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const socket = connectSocket();
      expect(() => socket.emit('error', new Error('socket err'))).not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  describe('startDiscovery', () => {
    test('skips malformed discovery entries instead of failing the entire response', async () => {
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([
        { xaddrs: [], name: 'Broken Camera' },
        { xaddrs: ['http://10.0.0.40/onvif/device_service'], name: 'Working Camera' }
      ]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(lastSent(socket)).toEqual({
        id: 'startDiscovery',
        result: {
          '10.0.0.40': {
            address: '10.0.0.40',
            name: 'Working Camera'
          }
        }
      });
    });

    test('returns terminal discovery errors to all queued websocket clients', async () => {
      jest.useFakeTimers();
      try {
        mockOnvifModule._probeInProgress = true;
        mockStartProbe.mockImplementation(() => (
          mockOnvifModule._probeInProgress
            ? Promise.reject(new Error('Discovery already in progress'))
            : Promise.reject(new Error('Probe failed'))
        ));

        const socketA = connectSocket();
        const socketB = connectSocket();
        sendMessage(socketA, { method: 'startDiscovery' });
        sendMessage(socketB, { method: 'startDiscovery' });
        await Promise.resolve();
        await Promise.resolve();

        mockOnvifModule._probeInProgress = false;

        jest.advanceTimersByTime(3000);
        await Promise.resolve();
        await Promise.resolve();

        expect(lastSent(socketA)).toEqual({
          id: 'startDiscovery',
          error: 'Probe failed'
        });
        expect(lastSent(socketB)).toEqual({
          id: 'startDiscovery',
          error: 'Probe failed'
        });
      } finally {
        jest.useRealTimers();
      }
    });

    test('replaces stale discovered devices with the latest probe results', async () => {
      const socket = connectSocket();
      mockStartProbe
        .mockResolvedValueOnce([
          { xaddrs: ['http://10.0.0.30/onvif/device_service'], name: 'Camera A' },
          { xaddrs: ['http://10.0.0.31/onvif/device_service'], name: 'Camera B' }
        ])
        .mockResolvedValueOnce([
          { xaddrs: ['http://10.0.0.30/onvif/device_service'], name: 'Camera A' }
        ]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(lastSent(socket)).toEqual({
        id: 'startDiscovery',
        result: {
          '10.0.0.30': { address: '10.0.0.30', name: 'Camera A' },
          '10.0.0.31': { address: '10.0.0.31', name: 'Camera B' }
        }
      });

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(lastSent(socket)).toEqual({
        id: 'startDiscovery',
        result: {
          '10.0.0.30': { address: '10.0.0.30', name: 'Camera A' }
        }
      });
    });
  });

  describe('connect', () => {
    test('responds with error for invalid IP address', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'connect', params: { address: 'not-an-ip' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(socket.send).toHaveBeenCalled();
      const resp = lastSent(socket);
      expect(resp.id).toBe('connect');
      expect(String(resp.error || '')).toMatch(/[Ii]nvalid/);
    });

    test('responds with error when device not in discovered list', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'connect', params: { address: '192.168.99.1' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('connect');
      expect(String(resp.error || '')).toContain('192.168.99.1');
    });

    test('uses request credentials when they are provided', async () => {
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.20/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'connect',
        params: {
          address: '10.0.0.20',
          user: 'override-user',
          pass: 'override-pass'
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const device = mockDeviceInstances[0];
      expect(device.setAuth).toHaveBeenCalledWith('override-user', 'override-pass');
      expect(lastSent(socket).id).toBe('connect');
    });

    test('clears stored credentials when blank credentials are provided', async () => {
      plugin.stop();
      plugin.start({
        snapshotInterval: 100,
        discoverOnStart: false,
        autoDiscoveryInterval: 0,
        userName: 'configured-user',
        password: 'configured-pass',
        cameras: [
          { address: '10.0.0.21', userName: 'camera-user', password: 'camera-pass' }
        ]
      });
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.21/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'connect',
        params: {
          address: '10.0.0.21',
          user: '',
          pass: ''
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const device = mockDeviceInstances[0];
      expect(device.setAuth).toHaveBeenCalledWith('', '');
      expect(lastSent(socket).id).toBe('connect');
    });

    test('uses blank per-camera credentials instead of inheriting global defaults', async () => {
      plugin.stop();
      plugin.start({
        snapshotInterval: 100,
        discoverOnStart: false,
        autoDiscoveryInterval: 0,
        userName: 'configured-user',
        password: 'configured-pass',
        cameras: [
          { address: '10.0.0.22', userName: '', password: '' }
        ]
      });
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.22/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'connect',
        params: {
          address: '10.0.0.22'
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const device = mockDeviceInstances[0];
      expect(device.setAuth).toHaveBeenCalledWith('', '');
      expect(lastSent(socket).id).toBe('connect');
    });

    test('publishes unique Signal K paths for colliding camera nicknames', async () => {
      plugin.stop();
      mockApp.handleMessage.mockReset();
      plugin.start({
        snapshotInterval: 100,
        discoverOnStart: false,
        autoDiscoveryInterval: 0,
        enableSignalKIntegration: true,
        cameras: [
          { address: '10.0.0.30', nickname: 'Bow Camera' },
          { address: '10.0.0.31', nickname: 'Bow Camera' }
        ]
      });

      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([
        { xaddrs: ['http://10.0.0.30/onvif/device_service'], name: 'Camera A' },
        { xaddrs: ['http://10.0.0.31/onvif/device_service'], name: 'Camera B' }
      ]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, { method: 'connect', params: { address: '10.0.0.30' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, { method: 'connect', params: { address: '10.0.0.31' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const paths = mockApp.handleMessage.mock.calls.map((call) => {
        const delta = call[1] as { updates: Array<{ values: Array<{ path: string }> }> };
        return delta.updates[0].values[0].path;
      });

      expect(paths).toContain('sensors.camera.bow_camera');
      expect(paths).toContain('sensors.camera.bow_camera_2');
    });
  });

  describe('fetchSnapshot', () => {
    test('responds with error for invalid address', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'fetchSnapshot', params: { address: 'bad' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(lastSent(socket).error).toBeDefined();
    });

    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'fetchSnapshot', params: { address: '10.1.2.3' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('fetchSnapshot');
      expect(resp.error).toBeDefined();
    });

    test('responds with error when requested profile is not found', async () => {
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.20/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'fetchSnapshot',
        params: {
          address: '10.0.0.20',
          profile: 'missing-profile'
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const resp = lastSent(socket);
      expect(resp.id).toBe('fetchSnapshot');
      expect(resp.error).toBe('Profile not found: missing-profile');
    });

    test('uses request-local profile snapshots without changing the device profile', async () => {
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.22/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'fetchSnapshot',
        params: {
          address: '10.0.0.22',
          profile: 'profile-1'
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const device = mockDeviceInstances[0];
      expect(device.fetchSnapshotForProfile).toHaveBeenCalledWith('profile-1', expect.any(Function));
      expect(device.changeProfile).not.toHaveBeenCalled();
      expect(lastSent(socket).id).toBe('fetchSnapshot');
    });

    test('echoes the snapshot request id in the websocket response', async () => {
      const socket = connectSocket();
      mockStartProbe.mockResolvedValue([{
        xaddrs: ['http://10.0.0.23/onvif/device_service'],
        name: 'Camera'
      }]);

      sendMessage(socket, { method: 'startDiscovery' });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      sendMessage(socket, {
        method: 'fetchSnapshot',
        params: {
          address: '10.0.0.23',
          requestId: 'snapshot-req-23'
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const resp = lastSent(socket);
      expect(resp.id).toBe('fetchSnapshot');
      expect(resp.requestId).toBe('snapshot-req-23');
    });
  });

  describe('ptzMove', () => {
    test('responds with error for invalid address', async () => {
      const socket = connectSocket();
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: 'x.x.x.x', speed: { x: 0, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzMove');
      expect(resp.error).toBeDefined();
    });

    test('responds with error when speed is out of range', async () => {
      const socket = connectSocket();
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: '192.168.1.1', speed: { x: 5, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(String(resp.error || '')).toMatch(/Speed X/);
    });

    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: '10.0.0.5', speed: { x: 0.5, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(lastSent(socket).error).toBeDefined();
    });
  });

  describe('ptzStop', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'ptzStop', params: { address: '10.0.0.6' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzStop');
      expect(resp.error).toBeDefined();
    });
  });

  describe('ptzHome', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'ptzHome', params: { address: '10.0.0.7' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzHome');
      expect(resp.error).toBeDefined();
    });
  });

  describe('getProfiles', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'getProfiles', params: { address: '10.0.0.8' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getProfiles');
      expect(resp.error).toBeDefined();
    });
  });

  describe('changeProfile', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'changeProfile', params: { address: '10.0.0.9', token: 'T1' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('changeProfile');
      expect(resp.error).toBeDefined();
    });
  });

  describe('getStreams', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'getStreams', params: { address: '10.0.0.10' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getStreams');
      expect(resp.error).toBeDefined();
    });
  });

  describe('getDeviceInfo', () => {
    test('responds with error when device not found', async () => {
      const socket = connectSocket();
      sendMessage(socket, { method: 'getDeviceInfo', params: { address: '10.0.0.11' } });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getDeviceInfo');
      expect(resp.error).toBeDefined();
    });
  });

  describe('plugin.stop()', () => {
    test('should call wsServer.close()', () => {
      plugin.stop();
      expect(mockWsClose).toHaveBeenCalled();
    });

    test('should close active websocket clients', () => {
      const socket = connectSocket();
      plugin.stop();
      expect(socket.close).toHaveBeenCalled();
    });
  });
});
