/*
MIT License

Copyright (c) 2022 Karl-Erik Gustafsson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict';

import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

import type { DeviceInformation, OnvifDeviceLike, OnvifDiscoveryDevice, ProfileInfo, SnapshotResponse, StreamInfo, UnknownRecord } from './lib/types';

const onvif = require('./lib/node-onvif') as {
  startProbe(ipAddress?: string): Promise<OnvifDiscoveryDevice[]>;
  stopProbe(): Promise<void>;
  OnvifDevice: new (params: { address?: string; xaddr?: string; user?: string; pass?: string }) => OnvifDeviceLike;
  _probeInProgress?: boolean;
};
const WebSocket = require('ws') as typeof import('ws');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
const { validateDeviceAddress, validatePTZCommand } = require('./lib/utils/validation') as {
  validateDeviceAddress(address: unknown): string;
  validatePTZCommand(params: UnknownRecord): UnknownRecord;
};

type TimerHandle = ReturnType<typeof setTimeout>;
type WsSocket = import('ws').default;
type WsServer = import('ws').Server;
type WsPermission = 'READ' | 'WRITE';

interface CameraConfig {
  name: string;
  nickname: string;
  userName: string;
  password: string;
}

interface PluginOptions {
  ipAddress?: string;
  userName?: string;
  password?: string;
  autoDiscoveryInterval?: number;
  snapshotInterval?: number;
  enableSignalKIntegration?: boolean;
  discoverOnStart?: boolean;
  startupDiscoveryDelay?: number;
  cameras?: Array<{
    address?: string;
    name?: string;
    nickname?: string;
    userName?: string;
    password?: string;
  }>;
}

interface PluginSchemaProperty {
  type: string;
  title?: string;
  default?: boolean | number | string;
  minimum?: number;
  required?: string[];
  items?: {
    type: string;
    required?: string[];
    properties: Record<string, PluginSchemaProperty>;
  };
  properties?: Record<string, PluginSchemaProperty>;
}

interface PluginUiSchema {
  password: {
    'ui:widget': 'password';
  };
  cameras?: {
    items: {
      password: {
        'ui:widget': 'password';
      };
    };
  };
}

interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  start(options: PluginOptions, restartPlugin?: unknown): void;
  stop(): void;
  _routesRegistered?: boolean;
  uiSchema: PluginUiSchema;
  schema: {
    type: 'object';
    title: string;
    description: string;
    properties: Record<string, PluginSchemaProperty>;
  };
}

interface AppServerLike {
  on(event: 'upgrade', listener: (request: IncomingMessage, socket: Socket, head: Buffer) => void): unknown;
  removeListener(event: 'upgrade', listener: (request: IncomingMessage, socket: Socket, head: Buffer) => void): unknown;
}

interface SecurityStrategyLike {
  shouldAllowRequest(req: HttpRequestLike, permission: string): boolean;
}

interface PluginApp {
  debug(...args: unknown[]): void;
  get?(path: string, handler: (req: HttpRequestLike, res: HttpResponseLike) => void): void;
  handleMessage?(pluginId: string, delta: UnknownRecord): void;
  securityStrategy?: SecurityStrategyLike;
  server?: AppServerLike | null;
}

interface HttpRequestLike {
  query: UnknownRecord;
  url?: string;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

interface HttpResponseLike {
  writeHead(status: number, headers: Record<string, string | number>): void;
  end(body?: string | Buffer): void;
  write(chunk: string | Buffer): void;
  flushHeaders(): void;
  socket?: {
    setNoDelay(noDelay: boolean): void;
  } | null;
  status?(code: number): {
    json(payload: UnknownRecord): void;
  };
}

type WsMethodId =
  | 'startDiscovery'
  | 'ping'
  | 'connect'
  | 'fetchSnapshot'
  | 'ptzMove'
  | 'ptzStop'
  | 'ptzHome'
  | 'getProfiles'
  | 'changeProfile'
  | 'getStreams'
  | 'getDeviceInfo';

interface WsResponse<TResult = unknown> {
  id: WsMethodId;
  requestId?: string;
  result?: TResult;
  error?: string;
}

interface DiscoveryResult {
  name: string;
  address: string;
}

interface ConnectResult extends DeviceInformation {
  streams: StreamInfo | null;
  mjpegUrl: string;
  snapshotUrl: string;
}

interface ProfilesResult {
  profiles: Array<{
    token: string;
    name: string;
    resolution: { width: number; height: number } | null;
    framerate: number | null;
    bitrate: number | null;
    encoding: string | null;
  }>;
  current: string | null;
}

interface StreamsResult {
  profile: string;
  rtsp: string;
  http: string;
  udp: string;
  snapshot: string;
  mjpeg: string;
}

interface DeviceInfoResult {
  info: DeviceInformation | null;
  hasPtz: boolean;
  hasEvents: boolean;
  profileCount: number;
  currentProfile: {
    token: string;
    name: string;
  } | null;
}

interface QueryParams {
  address?: unknown;
  profile?: unknown;
}

interface ConnectParams {
  address?: unknown;
  user?: unknown;
  pass?: unknown;
}

interface ChangeProfileParams {
  address?: unknown;
  token?: unknown;
  index?: unknown;
  profile?: unknown;
}

interface FetchSnapshotParams {
  address?: unknown;
  profile?: unknown;
  requestId?: unknown;
}

interface PtzMoveParams extends UnknownRecord {
  address?: unknown;
  speed?: unknown;
  timeout?: unknown;
}

interface DeviceSummaryMap {
  [address: string]: DiscoveryResult;
}

interface RegisteredDiscoveryDevice extends DiscoveryResult {
  device: OnvifDeviceLike;
  isNew: boolean;
}

interface HttpJsonResponse {
  error?: string;
  streams?: Array<{
    name: string;
    token: string;
    rtsp: string;
    http: string;
    udp: string;
    snapshot: string;
    video: ProfileInfo['video'];
    audio: ProfileInfo['audio'];
  }>;
  profiles?: Array<{
    token: string;
    name: string;
    resolution: { width: number; height: number } | null;
    framerate: number | null;
    encoding: string | null;
  }>;
  current?: string | null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getQueryString(query: UnknownRecord, key: string): string | undefined {
  return getStringValue(query[key]);
}

function getSnapshotContentType(result: SnapshotResponse): string {
  const contentType = result.headers['content-type'];
  if (typeof contentType === 'string') {
    return contentType;
  }
  return Array.isArray(contentType) ? (contentType[0] || 'image/jpeg') : 'image/jpeg';
}

function sendWsResponse<TResult>(conn: WsSocket, response: WsResponse<TResult>): void {
  if (conn.readyState === WebSocket.OPEN) {
    conn.send(JSON.stringify(response));
  }
}

function resolvePublicFilePath(fileName: string): string {
  const sourcePath = path.join(__dirname, 'public', fileName);
  if (fs.existsSync(path.join(__dirname, 'public'))) {
    return sourcePath;
  }

  return path.join(__dirname, '..', 'public', fileName);
}

module.exports = function createPlugin(app: PluginApp): PluginDefinition {
  const plugin: PluginDefinition = {
    id: 'signalk-onvif-camera',
    name: 'Signal K Onvif Camera Interface',
    description: 'Signal K Onvif Camera Interface',
    start() {},
    stop() {},
    uiSchema: {
      password: {
        'ui:widget': 'password'
      }
    },
    schema: {
      type: 'object',
      title: 'Onvif Camera Interface',
      description: 'Make an ONVIF user profile to camera(s) and add camera(s) IP below',
      properties: {}
    }
  };
  let ipAddress: string | undefined;
  let wsServer: WsServer | null = null;
  let upgradeHandler: ((request: IncomingMessage, socket: Socket, head: Buffer) => void) | null = null;
  let userName = '';
  let password = '';
  let autoDiscoveryInterval = 0;
  let autoDiscoveryTimer: TimerHandle | null = null;
  let startupDiscoveryTimer: TimerHandle | null = null;
  let snapshotInterval = 100;
  let enableSignalKIntegration = false;
  let discoverOnStart = true;
  let startupDiscoveryDelay = 5;
  let pluginRunning = false;
  let cameraConfigs: Record<string, CameraConfig> = {};
  let devices: Record<string, OnvifDeviceLike> = {};
  let deviceNames: Record<string, string> = {};
  let discoveredDevices: DeviceSummaryMap = {};
  let discoveryRetryTimer: TimerHandle | null = null;
  let discoveryPendingConns: WsSocket[] = [];
  const activeWsConnections = new Set<WsSocket>();
  const mjpegStreams = new Map<string, { abort: () => void }>(); // Track active MJPEG streams
  const MAX_MJPEG_STREAMS = 10;
  let mjpegStreamCounter = 0;

  plugin.start = function (options, _restartPlugin) {
    pluginRunning = true;
    userName = options.userName || '';
    password = options.password || '';
    ipAddress = options.ipAddress;
    autoDiscoveryInterval = options.autoDiscoveryInterval || 0;
    snapshotInterval = options.snapshotInterval || 100;
    enableSignalKIntegration = options.enableSignalKIntegration || false;
    discoverOnStart = options.discoverOnStart !== false; // Default true
    startupDiscoveryDelay = options.startupDiscoveryDelay || 5;
    discoveredDevices = {};

    // Build camera-specific config map
    cameraConfigs = {};
    const usedNicknames: Record<string, number> = {};
    if (options.cameras && Array.isArray(options.cameras)) {
      options.cameras.forEach(cam => {
        if (cam.address) {
          // Sanitize nickname for Signal K path (alphanumeric and underscore only)
          const rawNickname = cam.nickname || cam.name || cam.address;
          let sanitizedNickname = rawNickname.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          if (!/[a-z0-9]/.test(sanitizedNickname)) {
            sanitizedNickname = 'camera_' + cam.address.replace(/\./g, '_');
          }
          const baseNickname = sanitizedNickname;
          let nicknameSuffix = 2;
          while (usedNicknames[sanitizedNickname]) {
            sanitizedNickname = `${baseNickname}_${nicknameSuffix}`;
            nicknameSuffix++;
          }
          usedNicknames[sanitizedNickname] = 1;

          cameraConfigs[cam.address] = {
            name: cam.name || cam.address,
            nickname: sanitizedNickname,
            userName: typeof cam.userName === 'string' ? cam.userName : userName,
            password: typeof cam.password === 'string' ? cam.password : password
          };
        }
      });
    }

    const browserData = [{ 'snapshotInterval': snapshotInterval }];
    try {
      fs.writeFileSync(resolvePublicFilePath('browserdata.json'), JSON.stringify(browserData));
    } catch (error) {
      app.debug('Failed to write browserdata.json:', getErrorMessage(error));
    }

    // Register HTTP endpoints on SignalK's Express app (only once across restarts)
    if (!plugin._routesRegistered && typeof app.get === 'function') {
      app.get('/plugins/signalk-onvif-camera/mjpeg', (req, res) => {
        if (mjpegStreams.size >= MAX_MJPEG_STREAMS) {
          if (typeof res.status === 'function') {
            res.status(503).json({ error: 'Too many active streams' });
          } else {
            sendJsonResponse(res, 503, { error: 'Too many active streams' });
          }
          return;
        }
        handleMjpegStream(req, res, req.query);
      });
      app.get('/plugins/signalk-onvif-camera/snapshot', (req, res) => {
        handleSnapshotRequest(req, res, req.query);
      });
      app.get('/plugins/signalk-onvif-camera/api/streams', (req, res) => {
        handleStreamInfoRequest(req, res, req.query);
      });
      app.get('/plugins/signalk-onvif-camera/api/profiles', (req, res) => {
        handleProfilesRequest(req, res, req.query);
      });
      plugin._routesRegistered = true;
    }

    // Attach WebSocket server to SignalK's HTTP server.
    // Close any existing wsServer first to prevent leaks on restart.
    if (wsServer) {
      closeActiveWsConnections();
      wsServer.close();
      wsServer = null;
    }
    if (upgradeHandler && app.server) {
      app.server.removeListener('upgrade', upgradeHandler);
      upgradeHandler = null;
    }
    if (app.server) {
      // Use noServer mode so we don't interfere with SignalK's own
      // WebSocket server on the same HTTP server.  With the default
      // { server } option the ws library adds its own 'upgrade'
      // listener which can conflict with SignalK's stream endpoint.
      wsServer = new WebSocket.Server({ noServer: true });
      const currentWsServer = wsServer;
      currentWsServer.on('connection', wsServerConnection);

      upgradeHandler = (request, socket, head) => {
        let url;
        try {
          url = new URL(request.url || '/', 'ws://localhost');
        } catch (e) {
          socket.destroy();
          return;
        }
        if (url.pathname === '/plugins/signalk-onvif-camera/ws') {
          if (!isWsAuthorized(request, 'READ')) {
            try {
              socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 12\r\n\r\nUnauthorized');
            } catch (_error) {
              // Ignore write failures while rejecting unauthorized upgrades.
            }
            socket.destroy();
            return;
          }
          currentWsServer.handleUpgrade(request, socket, head, (ws: WsSocket) => {
            currentWsServer.emit('connection', ws, request);
          });
        }
        // Non-matching paths are left alone for SignalK to handle
      };
      app.server.on('upgrade', upgradeHandler);

      app.debug('Onvif Camera WebSocket server attached to SignalK server');
    } else {
      app.debug('SignalK app.server not available - WebSocket disabled');
    }

    // Start auto-discovery timer if configured
    if (autoDiscoveryInterval > 0) {
      setupAutoDiscovery();
    }

    // Run startup discovery if enabled
    if (discoverOnStart) {
      runStartupDiscovery();
    }
  };

  // Setup automatic periodic discovery
  function setupAutoDiscovery() {
    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
    }

    app.debug(`Auto-discovery enabled: every ${autoDiscoveryInterval} seconds`);

    autoDiscoveryTimer = setInterval(() => {
      if (!pluginRunning) {
        return;
      }
      app.debug('Running auto-discovery...');
      onvif.startProbe(ipAddress)
        .then((deviceList) => {
          if (!pluginRunning) {
            return;
          }
          const registeredDevices = replaceDiscoveredDevices(deviceList, 'Auto-discovery');
          registeredDevices.forEach((registeredDevice) => {
            if (registeredDevice.isNew) {
              app.debug(`Auto-discovered new camera: ${registeredDevice.name} (${registeredDevice.address})`);

              // Publish discovery to Signal K if enabled
              if (enableSignalKIntegration && app.handleMessage) {
                const nickname = getCameraNickname(registeredDevice.address);
                app.handleMessage(plugin.id, {
                  updates: [{
                    source: { label: plugin.id },
                    timestamp: new Date().toISOString(),
                    values: [{
                      path: `sensors.camera.${nickname}`,
                      value: {
                        address: registeredDevice.address,
                        discovered: true,
                        connected: false
                      }
                    }]
                  }]
                });
              }
            }
          });
        })
        .catch((error) => {
          if (pluginRunning) {
            app.debug('Auto-discovery error:', getErrorMessage(error));
          }
        });
    }, autoDiscoveryInterval * 1000);
  }

  // Run discovery once at startup after a delay
  function runStartupDiscovery() {
    app.debug(`Startup discovery scheduled in ${startupDiscoveryDelay} seconds...`);

    startupDiscoveryTimer = setTimeout(() => {
      if (!pluginRunning) {
        return;
      }
      app.debug('Running startup discovery...');
      onvif.startProbe(ipAddress)
        .then((deviceList) => {
          if (!pluginRunning) {
            return;
          }
          app.debug(`Startup discovery found ${deviceList.length} device(s)`);
          const registeredDevices = replaceDiscoveredDevices(deviceList, 'Startup discovery');
          registeredDevices.forEach(({ address: addr, name: deviceName, device: odevice, isNew }) => {
            if (isNew) {
              app.debug(`Startup discovered camera: ${deviceName} (${addr})`);
            }

            // Auto-connect pre-configured cameras and publish to Signal K
            const camConfig = cameraConfigs[addr];
            if (camConfig && enableSignalKIntegration) {
              // Set auth and initialize device
              odevice.setAuth(camConfig.userName, camConfig.password);
              odevice.init((error, result) => {
                if (!pluginRunning) {
                  return;
                }
                if (error) {
                  app.debug(`Failed to initialize camera ${addr}: ${error.message}`);
                  return;
                }
                try {
                  app.debug(`Auto-connected to pre-configured camera: ${addr}`);
                  if (result) {
                    publishCameraToSignalK(addr, result);
                  }
                } catch (publishError) {
                  app.debug(`Error publishing camera ${addr} to Signal K: ${getErrorMessage(publishError)}`);
                }
              });
            } else if (enableSignalKIntegration && app.handleMessage) {
              // Just publish discovery info for non-configured cameras
              const nickname = getCameraNickname(addr);
              app.handleMessage(plugin.id, {
                updates: [{
                  source: { label: plugin.id },
                  timestamp: new Date().toISOString(),
                  values: [{
                    path: `sensors.camera.${nickname}`,
                    value: {
                      address: addr,
                      discovered: true,
                      connected: false
                    }
                  }]
                }]
              });
            }
          });
        })
        .catch((error) => {
          if (pluginRunning) {
            app.debug('Startup discovery error:', getErrorMessage(error));
          }
        });
    }, startupDiscoveryDelay * 1000);
  }

  function closeActiveWsConnections(): void {
    activeWsConnections.forEach((conn) => {
      try {
        if (typeof conn.close === 'function') {
          conn.close();
        }
      } catch (_error) {
        const terminableConn = conn as unknown as { terminate?: () => void };
        if (typeof terminableConn.terminate === 'function') {
          try {
            terminableConn.terminate();
          } catch (_terminateError) {
            // Ignore shutdown errors while closing client sockets.
          }
        }
      }
    });
    activeWsConnections.clear();
  }

  function collectDiscoveryRecipients(primaryConn: WsSocket): WsSocket[] {
    const recipients = [primaryConn, ...discoveryPendingConns];
    discoveryPendingConns = [];
    if (discoveryRetryTimer) {
      clearTimeout(discoveryRetryTimer);
      discoveryRetryTimer = null;
    }
    return Array.from(new Set(recipients));
  }

  plugin.stop = function stop() {
    pluginRunning = false;
    devices = {};
    deviceNames = {};
    discoveredDevices = {};

    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
      autoDiscoveryTimer = null;
    }
    if (startupDiscoveryTimer) {
      clearTimeout(startupDiscoveryTimer);
      startupDiscoveryTimer = null;
    }
    if (discoveryRetryTimer) {
      clearTimeout(discoveryRetryTimer);
      discoveryRetryTimer = null;
    }
    discoveryPendingConns = [];
    onvif.stopProbe().catch(() => {
      // Ignore shutdown probe cancellation failures.
    });
    // Abort all active MJPEG streams so their sendFrame loops exit
    mjpegStreams.forEach((stream) => {
      stream.abort();
    });
    mjpegStreams.clear();
    closeActiveWsConnections();

    if (upgradeHandler && app.server) {
      app.server.removeListener('upgrade', upgradeHandler);
      upgradeHandler = null;
    }
    if (wsServer) {
      wsServer.close(() => {
        app.debug('Onvif Camera WebSocket server closed');
      });
      wsServer = null;
    }
  };

  plugin.uiSchema = {
    //hide password from ui
    password: {
      'ui:widget': 'password'
    }
  };

  plugin.schema = {
    type: 'object',
    title: 'Onvif Camera Interface',
    description: 'Make an ONVIF user profile to camera(s) and add camera(s) IP below',
    properties: {
      ipAddress: {
        type: 'string',
        title: 'IP address of LAN, where ONVIF devices are located. Default, leave empty.'
      },
      userName: {
        type: 'string',
        title: 'Default ONVIF username for camera(s)'
      },
      password: {
        type: 'string',
        title: 'Default ONVIF password for camera(s)'
      },
      autoDiscoveryInterval: {
        type: 'number',
        title: 'Auto-discovery interval in seconds (0 to disable)',
        default: 0
      },
      snapshotInterval: {
        type: 'number',
        title: 'Snapshot refresh interval in milliseconds',
        default: 100,
        minimum: 50
      },
      enableSignalKIntegration: {
        type: 'boolean',
        title: 'Publish camera data to Signal K paths',
        default: false
      },
      discoverOnStart: {
        type: 'boolean',
        title: 'Run camera discovery when plugin starts',
        default: true
      },
      startupDiscoveryDelay: {
        type: 'number',
        title: 'Delay before startup discovery in seconds',
        default: 5,
        minimum: 1
      },
      cameras: {
        type: 'array',
        title: 'Camera List',
        items: {
          type: 'object',
          required: [],
          properties: {
            address: {
              type: 'string',
              title: 'Camera address'
            },
            name: {
              type: 'string',
              title: 'Camera display name'
            },
            nickname: {
              type: 'string',
              title: 'Signal K path nickname (e.g., "bow", "stern", "mast"). Used in path: sensors.camera.[nickname]'
            },
            userName: {
              type: 'string',
              title: 'Camera-specific username (overrides default)'
            },
            password: {
              type: 'string',
              title: 'Camera-specific password (overrides default)'
            }
          }
        }
      }
    }
  };

  // Add UI schema for camera-specific passwords
  plugin.uiSchema.cameras = {
    items: {
      password: {
        'ui:widget': 'password'
      }
    }
  };

  function buildDeviceSummaryMap(): DeviceSummaryMap {
    const summaries: DeviceSummaryMap = {};
    Object.keys(discoveredDevices).forEach((addr) => {
      summaries[addr] = {
        name: discoveredDevices[addr].name,
        address: discoveredDevices[addr].address
      };
    });
    return summaries;
  }

  function registerDiscoveredDevice(device: OnvifDiscoveryDevice, context: string): RegisteredDiscoveryDevice | null {
    try {
      const xaddr = device.xaddrs[0];
      if (!xaddr) {
        throw new Error('No device service address was provided.');
      }

      const odevice = new onvif.OnvifDevice({ xaddr });
      const addr = odevice.address;
      const deviceName = (device.name || addr).replace(/%20/g, ' ');
      const isNew = !devices[addr];

      if (isNew) {
        devices[addr] = odevice;
      }
      deviceNames[addr] = deviceName;

      return {
        address: addr,
        name: deviceName,
        device: devices[addr] || odevice,
        isNew
      };
    } catch (error) {
      app.debug(`${context}: error processing device: ${getErrorMessage(error)}`);
      return null;
    }
  }

  function replaceDiscoveredDevices(deviceList: OnvifDiscoveryDevice[], context: string): RegisteredDiscoveryDevice[] {
    const summaries: DeviceSummaryMap = {};
    const registeredDevices = deviceList
      .map((device) => registerDiscoveredDevice(device, context))
      .filter((device): device is RegisteredDiscoveryDevice => device !== null);

    registeredDevices.forEach((device) => {
      summaries[device.address] = {
        address: device.address,
        name: device.name
      };
    });
    discoveredDevices = summaries;

    return registeredDevices;
  }

  function sendJsonResponse(res: HttpResponseLike, status: number, body: HttpJsonResponse): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function getProfileSelectionToken(params: ChangeProfileParams | FetchSnapshotParams | QueryParams): string | number | undefined {
    const token = getStringValue('token' in params ? params.token : undefined);
    if (token) {
      return token;
    }

    const profile = getStringValue(params.profile);
    if (profile) {
      return profile;
    }

    if ('index' in params) {
      const indexValue = params.index;
      if (typeof indexValue === 'number') {
        return indexValue;
      }
      const indexString = getStringValue(indexValue);
      if (indexString && /^\d+$/.test(indexString)) {
        return Number(indexString);
      }
    }

    return undefined;
  }

  // Returns false and sends a 401 if SignalK's security strategy rejects the request.
  // When no security strategy is installed (open/dev mode) all requests are allowed.
  function isAuthorized(req: HttpRequestLike, res: HttpResponseLike): boolean {
    if (app.securityStrategy && typeof app.securityStrategy.shouldAllowRequest === 'function') {
      if (!app.securityStrategy.shouldAllowRequest(req, 'READ')) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return false;
      }
    }
    return true;
  }

  function isWsAuthorized(req: IncomingMessage | undefined, permission: WsPermission): boolean {
    if (app.securityStrategy && typeof app.securityStrategy.shouldAllowRequest === 'function') {
      if (!req) {
        return false;
      }
      return app.securityStrategy.shouldAllowRequest(req as unknown as HttpRequestLike, permission);
    }
    return true;
  }

  function getWsPermission(method: WsMethodId): WsPermission {
    switch (method) {
      case 'connect':
      case 'ptzMove':
      case 'ptzStop':
      case 'ptzHome':
      case 'changeProfile':
        return 'WRITE';
      default:
        return 'READ';
    }
  }

  function isWsMethodId(method: string | undefined): method is WsMethodId {
    return method === 'startDiscovery'
      || method === 'ping'
      || method === 'connect'
      || method === 'fetchSnapshot'
      || method === 'ptzMove'
      || method === 'ptzStop'
      || method === 'ptzHome'
      || method === 'getProfiles'
      || method === 'changeProfile'
      || method === 'getStreams'
      || method === 'getDeviceInfo';
  }

  // MJPEG streaming handler
  function handleMjpegStream(req: HttpRequestLike, res: HttpResponseLike, query: UnknownRecord): void {
    if (!isAuthorized(req, res)) return;

    const address = getQueryString(query, 'address');
    const profileSelection = getProfileSelectionToken(query as ChangeProfileParams);
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing address parameter');
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(getErrorMessage(error));
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    // If profile token specified, switch to that profile
    if (profileSelection !== undefined) {
      const profile = device.getProfile(profileSelection);
      if (!profile) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Profile not found: ' + String(profileSelection));
        return;
      }
    }

    const boundary = 'mjpegboundary';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache',
      'X-Accel-Buffering': 'no'
    });
    // Flush headers immediately so proxies and browsers start receiving the stream
    res.flushHeaders();
    // Disable Nagle algorithm to ensure frames are sent without delay
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    const FRAME_TIMEOUT_MS = 10000;
    const streamId = `${address}-${++mjpegStreamCounter}`;
    let isActive = true;
    let frameTimer: TimerHandle | null = null;

    const stopStream = (endResponse: boolean): void => {
      isActive = false;
      if (frameTimer) {
        clearTimeout(frameTimer);
        frameTimer = null;
      }
      mjpegStreams.delete(streamId);
      if (endResponse) {
        try {
          res.end();
        } catch (_error) {
          // Ignore stream shutdown errors.
        }
      }
    };

    const sendFrame = () => {
      if (!isActive) return;

      let frameTimedOut = false;
      frameTimer = setTimeout(() => {
        frameTimedOut = true;
        stopStream(true);
      }, FRAME_TIMEOUT_MS);

      const fetchSnapshotCallback = (error: Error | null, result?: SnapshotResponse): void => {
        if (frameTimer) {
          clearTimeout(frameTimer);
          frameTimer = null;
        }
        if (frameTimedOut || !isActive) return;

        if (!error && result && result.body && result.body.length > 0) {
          const frame = result.body;
          const contentType = getSnapshotContentType(result);
          const header = `--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Length: ${frame.length}\r\n\r\n`;

          try {
            res.write(header);
            res.write(frame);
            res.write('\r\n');
          } catch (_error) {
            stopStream(false);
            return;
          }
        }

        if (isActive) {
          setTimeout(sendFrame, snapshotInterval);
        }
      };

      if (profileSelection !== undefined) {
        device.fetchSnapshotForProfile(profileSelection, fetchSnapshotCallback);
      } else {
        device.fetchSnapshot(fetchSnapshotCallback);
      }
    };

    mjpegStreams.set(streamId, {
      abort: () => {
        stopStream(true);
      }
    });

    req.on('close', () => {
      stopStream(false);
    });

    req.on('error', () => {
      stopStream(false);
    });

    sendFrame();
  }

  // Direct snapshot HTTP endpoint
  function handleSnapshotRequest(req: HttpRequestLike, res: HttpResponseLike, query: UnknownRecord): void {
    if (!isAuthorized(req, res)) return;

    const address = getQueryString(query, 'address');
    const profileSelection = getProfileSelectionToken(query as ChangeProfileParams);
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing address parameter');
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(getErrorMessage(error));
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    // If profile token specified, switch to that profile
    if (profileSelection !== undefined) {
      const profile = device.getProfile(profileSelection);
      if (!profile) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Profile not found: ' + String(profileSelection));
        return;
      }
    }

    const fetchSnapshotCallback = (error: Error | null, result?: SnapshotResponse): void => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to fetch snapshot: ' + (error.message || error));
        return;
      }

      if (!result || !result.body) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Snapshot returned no data');
        return;
      }

      const ct = getSnapshotContentType(result);
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': result.body.length,
        'Cache-Control': 'no-cache'
      });
      res.end(result.body);
    };

    if (profileSelection !== undefined) {
      device.fetchSnapshotForProfile(profileSelection, fetchSnapshotCallback);
    } else {
      device.fetchSnapshot(fetchSnapshotCallback);
    }
  }

  // Stream URIs endpoint
  function handleStreamInfoRequest(req: HttpRequestLike, res: HttpResponseLike, query: UnknownRecord): void {
    if (!isAuthorized(req, res)) return;

    const address = getQueryString(query, 'address');
    if (!address) {
      sendJsonResponse(res, 400, { error: 'Missing address parameter' });
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendJsonResponse(res, 400, { error: getErrorMessage(error) });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendJsonResponse(res, 404, { error: 'Device not found' });
      return;
    }

    const profiles = device.getProfileList();
    const streams = profiles.map(p => ({
      name: p.name,
      token: p.token,
      rtsp: p.stream.rtsp,
      http: p.stream.http,
      udp: p.stream.udp,
      snapshot: p.snapshot,
      video: p.video,
      audio: p.audio
    }));

    sendJsonResponse(res, 200, { streams });
  }

  // Profiles endpoint
  function handleProfilesRequest(req: HttpRequestLike, res: HttpResponseLike, query: UnknownRecord): void {
    if (!isAuthorized(req, res)) return;

    const address = getQueryString(query, 'address');
    if (!address) {
      sendJsonResponse(res, 400, { error: 'Missing address parameter' });
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendJsonResponse(res, 400, { error: getErrorMessage(error) });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendJsonResponse(res, 404, { error: 'Device not found' });
      return;
    }

    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();

    sendJsonResponse(res, 200, {
      profiles: profiles.map(p => ({
        token: p.token,
        name: p.name,
        resolution: p.video && p.video.encoder ? {
          width: p.video.encoder.resolution.width,
          height: p.video.encoder.resolution.height
        } : null,
        framerate: p.video && p.video.encoder ? p.video.encoder.framerate : null,
        encoding: p.video && p.video.encoder ? p.video.encoder.encoding : null
      })),
      current: currentProfile ? currentProfile.token : null
    });
  }

  function wsServerConnection(conn: WsSocket, request?: IncomingMessage): void {
    activeWsConnections.add(conn);
    const connWithCloseEvent = conn as WsSocket & {
      on(event: 'close', listener: () => void): WsSocket;
    };
    conn.on('message', (message: import('ws').RawData) => {
      try {
        const rawMessage = typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? Buffer.concat(message).toString('utf8')
            : Buffer.isBuffer(message)
              ? message.toString('utf8')
              : Buffer.from(message).toString('utf8');
        const parsed = JSON.parse(rawMessage) as unknown;
        if (!isRecord(parsed)) {
          throw new Error('WebSocket payload must be an object');
        }

        const method = getStringValue(parsed.method);
        const params = isRecord(parsed.params) ? parsed.params : {};
        if (isWsMethodId(method) && !isWsAuthorized(request, getWsPermission(method))) {
          sendWsResponse(conn, { id: method, error: 'Unauthorized' });
        } else if (method === 'startDiscovery') {
          startDiscovery(conn);
        } else if (method === 'ping') {
          sendWsResponse(conn, { id: 'ping', result: 'pong' });
        } else if (method === 'connect') {
          connect(conn, params);
        } else if (method === 'fetchSnapshot') {
          fetchSnapshot(conn, params);
        } else if (method === 'ptzMove') {
          ptzMove(conn, params);
        } else if (method === 'ptzStop') {
          ptzStop(conn, params);
        } else if (method === 'ptzHome') {
          ptzHome(conn, params);
        } else if (method === 'getProfiles') {
          getProfiles(conn, params);
        } else if (method === 'changeProfile') {
          changeProfile(conn, params);
        } else if (method === 'getStreams') {
          getStreams(conn, params);
        } else if (method === 'getDeviceInfo') {
          getDeviceInfo(conn, params);
        } else if (conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ error: `Unknown method: ${method || 'undefined'}` }));
        }
      } catch (error) {
        app.debug('Invalid JSON received from WebSocket:', getErrorMessage(error));
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ error: 'Invalid JSON format' }));
        }
      }
    });

    connWithCloseEvent.on('close', () => {
      activeWsConnections.delete(conn);
      discoveryPendingConns = discoveryPendingConns.filter((pendingConn) => pendingConn !== conn);
    });

    conn.on('error', (error: Error) => {
      activeWsConnections.delete(conn);
      discoveryPendingConns = discoveryPendingConns.filter((pendingConn) => pendingConn !== conn);
      app.debug('WebSocket error:', error.message || error);
    });
  }

  function startDiscovery(conn: WsSocket): void {
    onvif
      .startProbe(ipAddress)
      .then((deviceList) => {
        if (!pluginRunning) {
          return;
        }
        replaceDiscoveredDevices(deviceList, 'Discovery');
        const res: WsResponse<DeviceSummaryMap> = { id: 'startDiscovery', result: buildDeviceSummaryMap() };
        const allConns = collectDiscoveryRecipients(conn);
        allConns.forEach((socketConn) => {
          sendWsResponse(socketConn, res);
        });
      })
      .catch((error) => {
        if (!pluginRunning) {
          return;
        }
        const inProgress = onvif._probeInProgress;
        // If discovery is in progress, return cached devices if available
        if (inProgress && Object.keys(discoveredDevices).length > 0) {
          app.debug('Discovery in progress, returning cached devices');
          sendWsResponse(conn, { id: 'startDiscovery', result: buildDeviceSummaryMap() });
        } else if (inProgress) {
          // No cached devices yet — queue this client behind one shared retry timer
          discoveryPendingConns.push(conn);
          if (!discoveryRetryTimer) {
            app.debug('Discovery in progress, scheduling shared retry...');
            discoveryRetryTimer = setTimeout(() => {
              if (!pluginRunning) {
                return;
              }
              discoveryRetryTimer = null;
              const pending = discoveryPendingConns.splice(0);
              if (pending.length > 0) {
                discoveryPendingConns = pending.slice(1).filter((pendingConn) => pendingConn !== pending[0]);
                startDiscovery(pending[0]);
              }
            }, 3000);
          }
        } else {
          const allConns = collectDiscoveryRecipients(conn);
          allConns.forEach((socketConn) => {
            sendWsResponse(socketConn, { id: 'startDiscovery', error: getErrorMessage(error) });
          });
        }
      });
  }

  function connect(conn: WsSocket, params: UnknownRecord): void {
    const request = params as ConnectParams;
    const address = getStringValue(request.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, {
        id: 'connect',
        error: getErrorMessage(error)
      });
      return;
    }

    if (!address) {
      sendWsResponse(conn, {
        id: 'connect',
        error: 'Device address is required'
      });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, {
        id: 'connect',
        error: 'The specified device is not found: ' + address
      });
      return;
    }

    // Use per-camera credentials if available, otherwise use defaults
    const camConfig = cameraConfigs[address];
    const requestedUser = request.user;
    const requestedPass = request.pass;
    const hasRequestedUser = typeof requestedUser === 'string';
    const hasRequestedPass = typeof requestedPass === 'string';
    let authUser = userName;
    let authPass = password;

    if (camConfig) {
      authUser = camConfig.userName;
      authPass = camConfig.password;
    }

    if (hasRequestedUser) {
      authUser = requestedUser;
      authPass = hasRequestedPass ? requestedPass : '';
    } else if (hasRequestedPass) {
      authPass = requestedPass;
    }

    device.setAuth(authUser, authPass);

    device.init((error, result) => {
      const res: WsResponse<ConnectResult> = { id: 'connect' };
      if (error) {
        res.error = error.message || error.toString();
      } else {
        // Include additional info in result
        const currentProfile = device.getCurrentProfile();

        res.result = {
          ...result,
          streams: currentProfile ? currentProfile.stream : null,
          mjpegUrl: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(address)}`,
          snapshotUrl: `/plugins/signalk-onvif-camera/snapshot?address=${encodeURIComponent(address)}`
        };

        // Publish to Signal K if enabled
        if (enableSignalKIntegration && result) {
          publishCameraToSignalK(address, result);
        }
      }
      sendWsResponse(conn, res);
    });
  }

  // Get available profiles for a device
  function getProfiles(conn: WsSocket, params: UnknownRecord): void {
    const address = getStringValue(params.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, { id: 'getProfiles', error: getErrorMessage(error) });
      return;
    }

    if (!address) {
      sendWsResponse(conn, { id: 'getProfiles', error: 'Device address is required' });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, { id: 'getProfiles', error: 'Device not found' });
      return;
    }

    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();

    const res: WsResponse<ProfilesResult> = {
      id: 'getProfiles',
      result: {
        profiles: profiles.map(p => ({
          token: p.token,
          name: p.name,
          resolution: p.video && p.video.encoder ? {
            width: p.video.encoder.resolution.width,
            height: p.video.encoder.resolution.height
          } : null,
          framerate: p.video && p.video.encoder ? p.video.encoder.framerate : null,
          bitrate: p.video && p.video.encoder ? p.video.encoder.bitrate : null,
          encoding: p.video && p.video.encoder ? p.video.encoder.encoding : null
        })),
        current: currentProfile ? currentProfile.token : null
      }
    };
    sendWsResponse(conn, res);
  }

  // Change the active profile for a device
  function changeProfile(conn: WsSocket, params: UnknownRecord): void {
    const request = params as ChangeProfileParams;
    const address = getStringValue(request.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, { id: 'changeProfile', error: getErrorMessage(error) });
      return;
    }

    if (!address) {
      sendWsResponse(conn, { id: 'changeProfile', error: 'Device address is required' });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, { id: 'changeProfile', error: 'Device not found' });
      return;
    }

    const profileToken = getProfileSelectionToken(request);
    if (profileToken === undefined) {
      sendWsResponse(conn, { id: 'changeProfile', error: 'Profile token or index is required' });
      return;
    }
    app.debug(`Changing profile for ${address} to token: ${String(profileToken)}`);

    const newProfile = device.changeProfile(profileToken);

    if (newProfile) {
      app.debug(`Profile changed successfully. New profile: ${newProfile.name}, token: ${newProfile.token}`);
      app.debug(`Snapshot URL: ${newProfile.snapshot}`);
      const videoRes = newProfile.video && newProfile.video.encoder && newProfile.video.encoder.resolution;
      app.debug(`Video resolution: ${videoRes ? videoRes.width : 'unknown'}x${videoRes ? videoRes.height : 'unknown'}`);

      const res: WsResponse<{
        token: string;
        name: string;
        stream: StreamInfo;
        snapshot: string;
        video: ProfileInfo['video'];
      }> = {
        id: 'changeProfile',
        result: {
          token: newProfile.token,
          name: newProfile.name,
          stream: newProfile.stream,
          snapshot: newProfile.snapshot,
          video: newProfile.video
        }
      };
      sendWsResponse(conn, res);
    } else {
      app.debug(`Profile change failed - profile not found: ${profileToken}`);
      sendWsResponse(conn, { id: 'changeProfile', error: 'Profile not found: ' + String(profileToken) });
    }
  }

  // Get stream URIs for a device
  function getStreams(conn: WsSocket, params: UnknownRecord): void {
    const address = getStringValue(params.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, { id: 'getStreams', error: getErrorMessage(error) });
      return;
    }

    if (!address) {
      sendWsResponse(conn, { id: 'getStreams', error: 'Device address is required' });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, { id: 'getStreams', error: 'Device not found' });
      return;
    }

    const currentProfile = device.getCurrentProfile();
    if (!currentProfile) {
      sendWsResponse(conn, { id: 'getStreams', error: 'No profile selected' });
      return;
    }

    const res: WsResponse<StreamsResult> = {
      id: 'getStreams',
      result: {
        profile: currentProfile.name,
        rtsp: currentProfile.stream.rtsp,
        http: currentProfile.stream.http,
        udp: currentProfile.stream.udp,
        snapshot: currentProfile.snapshot,
        mjpeg: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(address)}`
      }
    };
    sendWsResponse(conn, res);
  }

  // Get detailed device info
  function getDeviceInfo(conn: WsSocket, params: UnknownRecord): void {
    const address = getStringValue(params.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, { id: 'getDeviceInfo', error: getErrorMessage(error) });
      return;
    }

    if (!address) {
      sendWsResponse(conn, { id: 'getDeviceInfo', error: 'Device address is required' });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, { id: 'getDeviceInfo', error: 'Device not found' });
      return;
    }

    const info = device.getInformation();
    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();
    const hasPtz = !!device.services.ptz;
    const hasEvents = !!device.services.events;

    const res: WsResponse<DeviceInfoResult> = {
      id: 'getDeviceInfo',
      result: {
        info,
        hasPtz,
        hasEvents,
        profileCount: profiles.length,
        currentProfile: currentProfile ? {
          token: currentProfile.token,
          name: currentProfile.name
        } : null
      }
    };
    sendWsResponse(conn, res);
  }

  // Get nickname for a camera address
  function getCameraNickname(address: string): string {
    const camConfig = cameraConfigs[address];
    if (camConfig && camConfig.nickname) {
      return camConfig.nickname;
    }
    // Fallback: convert IP to safe path name
    return address.replace(/\./g, '_');
  }

  // Publish camera info to Signal K with nested values
  function publishCameraToSignalK(address: string, deviceInfo: DeviceInformation): void {
    if (!app.handleMessage) return;

    const nickname = getCameraNickname(address);
    const basePath = `sensors.camera.${nickname}`;

    // Build nested value object with only snapshot and MJPEG paths
    const cameraData = {
      manufacturer: deviceInfo.Manufacturer || 'Unknown',
      model: deviceInfo.Model || 'Unknown',
      address: address,
      connected: true,
      snapshot: `/plugins/signalk-onvif-camera/snapshot?address=${encodeURIComponent(address)}`,
      mjpeg: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(address)}`
    };

    const delta = {
      updates: [{
        source: { label: plugin.id },
        timestamp: new Date().toISOString(),
        values: [{
          path: basePath,
          value: cameraData
        }]
      }]
    };

    app.handleMessage(plugin.id, delta);
  }

  function fetchSnapshot(conn: WsSocket, params: UnknownRecord): void {
    const request = params as FetchSnapshotParams;
    const address = getStringValue(request.address);
    const requestId = getStringValue(request.requestId);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, {
        id: 'fetchSnapshot',
        requestId,
        error: getErrorMessage(error)
      });
      return;
    }

    if (!address) {
      sendWsResponse(conn, {
        id: 'fetchSnapshot',
        requestId,
        error: 'Device address is required'
      });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, {
        id: 'fetchSnapshot',
        requestId,
        error: 'The specified device is not found: ' + address
      });
      return;
    }

    // If profile token specified, switch to that profile first
    const profileSelection = getProfileSelectionToken(request);
    const snapshotProfile = profileSelection !== undefined
      ? device.getProfile(profileSelection)
      : device.getCurrentProfile();
    if (profileSelection !== undefined && !snapshotProfile) {
      sendWsResponse(conn, {
        id: 'fetchSnapshot',
        requestId,
        error: 'Profile not found: ' + String(profileSelection)
      });
      return;
    }

    // Log current profile being used for snapshot
    const currentProfile = snapshotProfile;
    if (currentProfile) {
      app.debug(`Fetching snapshot - profile: ${currentProfile.name} (${currentProfile.token}), snapshot URL: ${currentProfile.snapshot}`);
    }

    const fetchSnapshotCallback = (error: Error | null, result?: SnapshotResponse): void => {
      const res: WsResponse<string> = { id: 'fetchSnapshot', requestId };
      if (error) {
        res.error = error.message || error.toString();
      } else if (!result || !result.body) {
        res.error = 'Snapshot returned no data';
      } else {
        const ct = getSnapshotContentType(result);
        const b64 = result.body.toString('base64');
        res.result = 'data:' + ct + ';base64,' + b64;
      }
      sendWsResponse(conn, res);
    };

    if (profileSelection !== undefined) {
      device.fetchSnapshotForProfile(profileSelection, fetchSnapshotCallback);
    } else {
      device.fetchSnapshot(fetchSnapshotCallback);
    }
  }

  function ptzMove(conn: WsSocket, params: UnknownRecord): void {
    try {
      validatePTZCommand(params as PtzMoveParams);
    } catch (error) {
      sendWsResponse(conn, {
        id: 'ptzMove',
        error: getErrorMessage(error)
      });
      return;
    }

    const address = getStringValue(params.address);
    if (!address) {
      sendWsResponse(conn, {
        id: 'ptzMove',
        error: 'Device address is required'
      });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, {
        id: 'ptzMove',
        error: 'The specified device is not found: ' + address
      });
      return;
    }
    device.ptzMove(params, (error) => {
      const res: WsResponse<boolean> = { id: 'ptzMove' };
      if (error) {
        res.error = error.toString();
      } else {
        res.result = true;
      }
      sendWsResponse(conn, res);
    });
  }

  function ptzStop(conn: WsSocket, params: UnknownRecord): void {
    const address = getStringValue(params.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, {
        id: 'ptzStop',
        error: getErrorMessage(error)
      });
      return;
    }

    if (!address) {
      sendWsResponse(conn, {
        id: 'ptzStop',
        error: 'Device address is required'
      });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, {
        id: 'ptzStop',
        error: 'The specified device is not found: ' + address
      });
      return;
    }
    device.ptzStop((error) => {
      const res: WsResponse<boolean> = { id: 'ptzStop' };
      if (error) {
        res.error = error.toString();
      } else {
        res.result = true;
      }
      sendWsResponse(conn, res);
    });
  }

  function ptzHome(conn: WsSocket, params: UnknownRecord): void {
    const address = getStringValue(params.address);
    try {
      validateDeviceAddress(address);
    } catch (error) {
      sendWsResponse(conn, {
        id: 'ptzHome',
        error: getErrorMessage(error)
      });
      return;
    }

    if (!address) {
      sendWsResponse(conn, {
        id: 'ptzHome',
        error: 'Device address is required'
      });
      return;
    }

    const device = devices[address];
    if (!device) {
      sendWsResponse(conn, {
        id: 'ptzHome',
        error: 'The specified device is not found: ' + address
      });
      return;
    }
    if (!device.services.ptz) {
      sendWsResponse(conn, {
        id: 'ptzHome',
        error: 'The specified device does not support PTZ.'
      });
      return;
    }

    const ptz = device.services.ptz;
    const profile = device.getCurrentProfile();
    if (!profile) {
      sendWsResponse(conn, { id: 'ptzHome', error: 'No media profile selected' });
      return;
    }
    const ptzParams = {
      ProfileToken: profile.token,
      Speed: 1
    };
    ptz.gotoHomePosition(ptzParams, (error, _result) => {
      const res: WsResponse<boolean> = { id: 'ptzHome' };
      if (error) {
        res.error = error.toString();
      } else {
        res.result = true;
      }
      sendWsResponse(conn, res);
    });
  }

  return plugin;
};
