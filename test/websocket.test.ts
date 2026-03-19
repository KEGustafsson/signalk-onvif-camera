/**
 * Tests for WebSocket message handling and handler dispatch
 *
 * The plugin attaches a ws.Server to app.server. We mock ws at module level,
 * capture the 'connection' handler, and exercise all message-dispatch paths.
 */

const EventEmitter = require('events');

// ── ws mock (must be at module level; factory may only reference `mock*` vars) ─

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

function withConnectionHandler(socket) {
  if (!mockConnectionHandler) {
    throw new Error('Expected WebSocket connection handler');
  }
  mockConnectionHandler(socket);
}

// ── test setup ───────────────────────────────────────────────────────────────

describe('WebSocket message handling', () => {
  let plugin;
  let mockApp;

  beforeEach(() => {
    jest.resetModules();
    mockConnectionHandler = null;
    mockWsClose.mockReset();

    const mockServer = new EventEmitter();
    mockApp = {
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      debug: jest.fn(),
      handleMessage: jest.fn(),
      get: jest.fn(),
      server: mockServer,
      getDataDirPath: jest.fn(() => '/tmp/test-signalk')
    };

    const createPlugin = require('../index');
    plugin = createPlugin(mockApp);
    plugin.start({ snapshotInterval: 100, discoverOnStart: false, autoDiscoveryInterval: 0 });
  });

  afterEach(() => {
    try { plugin.stop(); } catch (_) {}
  });

  // ── setup verification ───────────────────────────────────────────────────────

  test('should create ws.Server in noServer mode', () => {
    const WS = require('ws');
    expect(WS.Server).toHaveBeenCalledWith(
      expect.objectContaining({ noServer: true })
    );
  });

  test('should register a connection handler on ws.Server', () => {
    expect(mockConnectionHandler).toBeInstanceOf(Function);
  });

  // ── invalid JSON / unknown method ────────────────────────────────────────────

  describe('invalid JSON', () => {
    test('should send error response for malformed message', () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      socket.emit('message', '{bad-json}');
      expect(socket.send).toHaveBeenCalledTimes(1);
      expect(lastSent(socket).error).toBeDefined();
    });

    test('should not send when socket is not OPEN', () => {
      const socket = makeSocket();
      socket.readyState = 3; // CLOSED
      withConnectionHandler(socket);
      socket.emit('message', 'not-json');
      expect(socket.send).not.toHaveBeenCalled();
    });

    test('should respond with error for unknown method', () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      socket.emit('message', JSON.stringify({ method: 'nonExistentMethod', params: {} }));
      expect(socket.send).toHaveBeenCalled();
      expect(lastSent(socket).error).toMatch(/Unknown method/);
    });

    test('should not throw when params field is absent from message', async () => {
      // Regression: before fix, missing params caused TypeError in handlers
      const socket = makeSocket();
      withConnectionHandler(socket);
      expect(() =>
        socket.emit('message', JSON.stringify({ method: 'connect' }))
      ).not.toThrow();
      await new Promise(r => setTimeout(r, 10));
      // Should get an error response (invalid address), not a crash
      expect(socket.send).toHaveBeenCalled();
      expect(lastSent(socket).error).toBeDefined();
    });
  });

  // ── socket lifecycle ─────────────────────────────────────────────────────────

  describe('socket lifecycle', () => {
    test('close event should not throw', () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      expect(() => socket.emit('close')).not.toThrow();
    });

    test('error event should log but not throw', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const socket = makeSocket();
      withConnectionHandler(socket);
      expect(() => socket.emit('error', new Error('socket err'))).not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  // ── connect ──────────────────────────────────────────────────────────────────

  describe('connect', () => {
    test('responds with error for invalid IP address', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'connect', params: { address: 'not-an-ip' } });
      await new Promise(r => setTimeout(r, 10));
      expect(socket.send).toHaveBeenCalled();
      const resp = lastSent(socket);
      expect(resp.id).toBe('connect');
      expect(resp.error).toMatch(/[Ii]nvalid/);
    });

    test('responds with error when device not in discovered list', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'connect', params: { address: '192.168.99.1' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('connect');
      expect(resp.error).toContain('192.168.99.1');
    });
  });

  // ── fetchSnapshot ──────────────────────────────────────────────────────────

  describe('fetchSnapshot', () => {
    test('responds with error for invalid address', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'fetchSnapshot', params: { address: 'bad' } });
      await new Promise(r => setTimeout(r, 10));
      expect(lastSent(socket).error).toBeDefined();
    });

    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'fetchSnapshot', params: { address: '10.1.2.3' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('fetchSnapshot');
      expect(resp.error).toBeDefined();
    });
  });

  // ── ptzMove ───────────────────────────────────────────────────────────────

  describe('ptzMove', () => {
    test('responds with error for invalid address', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: 'x.x.x.x', speed: { x: 0, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzMove');
      expect(resp.error).toBeDefined();
    });

    test('responds with error when speed is out of range', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: '192.168.1.1', speed: { x: 5, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.error).toMatch(/Speed X/);
    });

    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, {
        method: 'ptzMove',
        params: { address: '10.0.0.5', speed: { x: 0.5, y: 0, z: 0 }, timeout: 10 }
      });
      await new Promise(r => setTimeout(r, 10));
      expect(lastSent(socket).error).toBeDefined();
    });
  });

  // ── ptzStop ───────────────────────────────────────────────────────────────

  describe('ptzStop', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'ptzStop', params: { address: '10.0.0.6' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzStop');
      expect(resp.error).toBeDefined();
    });
  });

  // ── ptzHome ───────────────────────────────────────────────────────────────

  describe('ptzHome', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'ptzHome', params: { address: '10.0.0.7' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('ptzHome');
      expect(resp.error).toBeDefined();
    });
  });

  // ── getProfiles ───────────────────────────────────────────────────────────

  describe('getProfiles', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'getProfiles', params: { address: '10.0.0.8' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getProfiles');
      expect(resp.error).toBeDefined();
    });
  });

  // ── changeProfile ─────────────────────────────────────────────────────────

  describe('changeProfile', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'changeProfile', params: { address: '10.0.0.9', token: 'T1' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('changeProfile');
      expect(resp.error).toBeDefined();
    });
  });

  // ── getStreams ────────────────────────────────────────────────────────────

  describe('getStreams', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'getStreams', params: { address: '10.0.0.10' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getStreams');
      expect(resp.error).toBeDefined();
    });
  });

  // ── getDeviceInfo ─────────────────────────────────────────────────────────

  describe('getDeviceInfo', () => {
    test('responds with error when device not found', async () => {
      const socket = makeSocket();
      withConnectionHandler(socket);
      sendMessage(socket, { method: 'getDeviceInfo', params: { address: '10.0.0.11' } });
      await new Promise(r => setTimeout(r, 10));
      const resp = lastSent(socket);
      expect(resp.id).toBe('getDeviceInfo');
      expect(resp.error).toBeDefined();
    });
  });

  // ── plugin.stop() closes wsServer ────────────────────────────────────────

  describe('plugin.stop()', () => {
    test('should call wsServer.close()', () => {
      plugin.stop();
      expect(mockWsClose).toHaveBeenCalled();
    });
  });
});
