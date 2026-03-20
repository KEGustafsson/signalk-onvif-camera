/**
 * Regression test: ptzHome must return an error (not throw TypeError)
 * when a device has a PTZ service but no current media profile selected.
 *
 * This scenario occurs when a camera's init() sets up services.ptz
 * but GetProfiles returns an empty profile list, leaving current_profile null.
 */

import type { ConnectionHandler, CreatePlugin, JsonRecord, MockApp, MockSocket, PluginLike } from './test-types';

const { EventEmitter } = require('events') as typeof import('events');

let mockConnectionHandler: ConnectionHandler | null = null;
const mockWsClose = jest.fn();

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

  return { Server: jest.fn(() => new MockWsServer()), OPEN: 1 };
});

jest.mock('../lib/node-onvif', () => {
  interface MockOnvifDeviceState {
    address: string;
    services: {
      ptz: {
        gotoHomePosition: jest.Mock<void, [JsonRecord, (error: Error | null, result: JsonRecord) => void]>;
      };
      media: null;
      device: null;
      events: null;
    };
    getCurrentProfile: jest.Mock<null, []>;
    getProfileList: jest.Mock<[], []>;
    getInformation: jest.Mock<JsonRecord, []>;
    setAuth: jest.Mock<void, []>;
    init: jest.Mock<void, [(error: Error | null, result: JsonRecord) => void]>;
    changeProfile: jest.Mock<null, []>;
    fetchSnapshot: jest.Mock<void, []>;
    ptzMove: jest.Mock<void, []>;
    ptzStop: jest.Mock<void, []>;
  }

  const MockOnvifDevice = function (this: MockOnvifDeviceState, params: { xaddr?: string; address?: string }) {
    const xaddr = params.xaddr || `http://${params.address || '127.0.0.1'}/onvif/device_service`;
    try {
      this.address = new URL(xaddr).hostname;
    } catch (_error) {
      this.address = params.address || '127.0.0.1';
    }
    this.services = {
      ptz: { gotoHomePosition: jest.fn((_params, callback) => callback(null, {})) },
      media: null,
      device: null,
      events: null
    };
    this.getCurrentProfile = jest.fn().mockReturnValue(null);
    this.getProfileList = jest.fn().mockReturnValue([]);
    this.getInformation = jest.fn().mockReturnValue({});
    this.setAuth = jest.fn();
    this.init = jest.fn((callback) => callback(null, {}));
    this.changeProfile = jest.fn().mockReturnValue(null);
    this.fetchSnapshot = jest.fn();
    this.ptzMove = jest.fn();
    this.ptzStop = jest.fn();
  };

  return {
    OnvifDevice: MockOnvifDevice,
    stopProbe: jest.fn().mockResolvedValue(undefined),
    startProbe: jest.fn().mockResolvedValue([{
      xaddrs: ['http://192.168.1.50/onvif/device_service'],
      name: 'Test Camera',
      urn: 'urn:uuid:test-ptz-no-profile'
    }])
  };
});

function makeSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.readyState = 1;
  socket.send = jest.fn();
  return socket;
}

function sendMessage(socket: MockSocket, obj: JsonRecord): void {
  socket.emit('message', JSON.stringify(obj));
}

function lastSent(socket: MockSocket): JsonRecord {
  const calls = socket.send.mock.calls as Array<[string]>;
  return JSON.parse(calls[calls.length - 1][0]) as JsonRecord;
}

describe('ptzHome null-profile guard', () => {
  let plugin: PluginLike;

  beforeEach(async () => {
    jest.resetModules();
    mockConnectionHandler = null;
    mockWsClose.mockReset();

    const mockServer = new EventEmitter();
    const mockApp: MockApp = {
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index') as CreatePlugin;
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });

    const setupSocket = makeSocket();
    const handler = mockConnectionHandler;
    if(!handler) {
      throw new Error('WebSocket connection handler was not registered');
    }
    const connectionHandler = handler as ConnectionHandler;
    connectionHandler(setupSocket);
    sendMessage(setupSocket, { method: 'startDiscovery', params: {} });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_error) {}
  });

  test('responds with error (not TypeError) when no media profile is selected', async () => {
    const socket = makeSocket();
    if(!mockConnectionHandler) {
      throw new Error('WebSocket connection handler was not registered');
    }
    mockConnectionHandler(socket);
    sendMessage(socket, { method: 'ptzHome', params: { address: '192.168.1.50' } });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(socket.send).toHaveBeenCalled();
    const resp = lastSent(socket);
    expect(resp.id).toBe('ptzHome');
    expect(resp.error).toBe('No media profile selected');
  });
});
