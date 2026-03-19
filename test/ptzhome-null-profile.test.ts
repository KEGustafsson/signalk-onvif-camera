/**
 * Regression test: ptzHome must return an error (not throw TypeError)
 * when a device has a PTZ service but no current media profile selected.
 *
 * This scenario occurs when a camera's init() sets up services.ptz
 * but GetProfiles returns an empty profile list, leaving current_profile null.
 */

const EventEmitter = require('events');

// ── ws mock ─────────────────────────────────────────────────────────────────

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

// ── onvif mock: device with PTZ service but no current profile ───────────────

jest.mock('../lib/node-onvif', () => {
  function MockOnvifDevice(params) {
    const xaddr = params.xaddr || `http://${params.address || '127.0.0.1'}/onvif/device_service`;
    try {
      this.address = new URL(xaddr).hostname;
    } catch (_) {
      this.address = params.address || '127.0.0.1';
    }
    // PTZ service is present but no profile is selected
    this.services = {
      ptz: { gotoHomePosition: jest.fn((p, cb) => cb(null, {})) },
      media: null,
      device: null,
      events: null
    };
    this.getCurrentProfile = jest.fn().mockReturnValue(null);
    this.getProfileList = jest.fn().mockReturnValue([]);
    this.getInformation = jest.fn().mockReturnValue({});
    this.setAuth = jest.fn();
    this.init = jest.fn((cb) => cb(null, {}));
    this.changeProfile = jest.fn().mockReturnValue(null);
    this.fetchSnapshot = jest.fn();
    this.ptzMove = jest.fn();
    this.ptzStop = jest.fn();
  }

  return {
    OnvifDevice: MockOnvifDevice,
    startProbe: jest.fn().mockResolvedValue([{
      xaddrs: ['http://192.168.1.50/onvif/device_service'],
      name: 'Test Camera',
      urn: 'urn:uuid:test-ptz-no-profile'
    }])
  };
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSocket() {
  const socket = new EventEmitter();
  socket.readyState = 1; // WebSocket.OPEN
  socket.send = jest.fn();
  return socket;
}

function sendMessage(socket, obj) {
  socket.emit('message', JSON.stringify(obj));
}

function lastSent(socket) {
  const calls = socket.send.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ptzHome null-profile guard', () => {
  let plugin;

  beforeEach(async () => {
    jest.resetModules();
    mockConnectionHandler = null;
    mockWsClose.mockReset();

    const mockServer = new EventEmitter();
    const mockApp = {
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index');
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });

    // Populate the devices map via the startDiscovery WS handler
    const setupSocket = makeSocket();
    if (!mockConnectionHandler) {
      throw new Error('Expected PTZ home test WebSocket connection handler');
    }
    (mockConnectionHandler as (socket: unknown) => void)(setupSocket);
    sendMessage(setupSocket, { method: 'startDiscovery', params: {} });
    // Wait for startProbe promise to resolve and device to be registered
    await new Promise(r => setTimeout(r, 50));
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_) {}
  });

  test('responds with error (not TypeError) when no media profile is selected', async () => {
    const socket = makeSocket();
    if (!mockConnectionHandler) {
      throw new Error('Expected PTZ home test WebSocket connection handler');
    }
    mockConnectionHandler!(socket);
    sendMessage(socket, { method: 'ptzHome', params: { address: '192.168.1.50' } });
    await new Promise(r => setTimeout(r, 10));
    expect(socket.send).toHaveBeenCalled();
    const resp = lastSent(socket);
    expect(resp.id).toBe('ptzHome');
    expect(resp.error).toBe('No media profile selected');
  });
});
