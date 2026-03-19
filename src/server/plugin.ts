'use strict';

import type { PluginOptions } from '../shared/protocol';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { buildCameraConfigs } = require('./domain/camera-config');
const { createOnvifAdapter } = require('../onvif/device-adapter');
const { createSignalKCameraPublisher } = require('./services/signalk-camera-publisher');
const { createDiscoveryService } = require('./services/discovery-service');
const { createCameraService } = require('./services/camera-service');
const { createMjpegStreamManager } = require('./services/mjpeg-stream-manager');
const { createHttpController } = require('./http/controller');
const { createWsController } = require('./ws/controller');
const { pluginSchema, pluginUiSchema } = require('./config/plugin-schema');

module.exports = function createPlugin(app) {
  const plugin: {
    id: string;
    name: string;
    description: string;
    schema: unknown;
    uiSchema: unknown;
    _routesRegistered?: boolean;
    start?: (options: {
      ipAddress?: string;
      userName?: string;
      password?: string;
      autoDiscoveryInterval?: number;
      snapshotInterval?: number;
      enableSignalKIntegration?: boolean;
      discoverOnStart?: boolean;
      startupDiscoveryDelay?: number;
      cameras?: Array<Record<string, unknown>>;
    }) => void;
    stop?: () => void;
  } = {
    id: 'signalk-onvif-camera',
    name: 'Signal K Onvif Camera Interface',
    description: 'Signal K Onvif Camera Interface',
    schema: pluginSchema,
    uiSchema: pluginUiSchema
  };

  let optionsState: PluginOptions & { cameraConfigs: Record<string, { nickname: string; userName?: string; password?: string; name: string }> } = {
    ipAddress: undefined,
    userName: undefined,
    password: undefined,
    autoDiscoveryInterval: 0,
    snapshotInterval: 100,
    enableSignalKIntegration: false,
    discoverOnStart: true,
    startupDiscoveryDelay: 5,
    cameraConfigs: {}
  };
  let wsServer: InstanceType<typeof WebSocket.Server> | null = null;
  let upgradeHandler: ((request: { url?: string }, socket: { destroy(): void }, head: Buffer) => void) | null = null;
  let autoDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
  let startupDiscoveryTimer: ReturnType<typeof setTimeout> | null = null;

  const onvifAdapter = createOnvifAdapter();
  let publisher = createSignalKCameraPublisher({
    app,
    pluginId: plugin.id,
    getCameraNickname: (address) => optionsState.cameraConfigs[address] && optionsState.cameraConfigs[address].nickname
      ? optionsState.cameraConfigs[address].nickname
      : String(address).replace(/\./g, '_')
  });
  let discoveryService = createDiscoveryService({
    app,
    onvifAdapter,
    enableSignalKIntegration: optionsState.enableSignalKIntegration,
    cameraConfigs: optionsState.cameraConfigs,
    publisher
  });
  let cameraService = createCameraService({
    app,
    cameraConfigs: optionsState.cameraConfigs,
    defaultCredentials: { userName: optionsState.userName, password: optionsState.password },
    devices: discoveryService.state.devices,
    publisher,
    enableSignalKIntegration: optionsState.enableSignalKIntegration
  });
  let mjpegManager = createMjpegStreamManager({ snapshotInterval: optionsState.snapshotInterval });
  let httpController = createHttpController({ app, cameraService, mjpegManager });
  let wsController = createWsController({ app, cameraService, discoveryService });

  function rebuildRuntimeServices() {
    publisher = createSignalKCameraPublisher({
      app,
      pluginId: plugin.id,
      getCameraNickname: (address) => cameraService.getCameraNickname(address)
    });
    discoveryService = createDiscoveryService({
      app,
      onvifAdapter,
      enableSignalKIntegration: optionsState.enableSignalKIntegration,
      cameraConfigs: optionsState.cameraConfigs,
      publisher,
      getProbeIpAddress: () => optionsState.ipAddress
    });
    cameraService = createCameraService({
      app,
      cameraConfigs: optionsState.cameraConfigs,
      defaultCredentials: { userName: optionsState.userName, password: optionsState.password },
      devices: discoveryService.state.devices,
      publisher,
      enableSignalKIntegration: optionsState.enableSignalKIntegration
    });
    mjpegManager = createMjpegStreamManager({ snapshotInterval: optionsState.snapshotInterval });
    httpController = createHttpController({ app, cameraService, mjpegManager });
    wsController = createWsController({ app, cameraService, discoveryService });
  }

  function writeBrowserData() {
    const browserData = [{ snapshotInterval: optionsState.snapshotInterval }];
    try {
      fs.writeFileSync(path.join(__dirname, '../../public/browserdata.json'), JSON.stringify(browserData));
    } catch (error) {
      app.debug('Failed to write browserdata.json:', error instanceof Error ? error.message : String(error));
    }
  }

  function setupAutoDiscovery() {
    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
    }
    app.debug(`Auto-discovery enabled: every ${optionsState.autoDiscoveryInterval} seconds`);
    autoDiscoveryTimer = setInterval(() => {
      app.debug('Running auto-discovery...');
      onvifAdapter.startProbe(optionsState.ipAddress)
        .then((deviceList) => {
          discoveryService.processAutoDiscoveredDevices(deviceList);
        })
        .catch((error) => {
          app.debug('Auto-discovery error:', error instanceof Error ? error.message : String(error));
        });
    }, (optionsState.autoDiscoveryInterval ?? 0) * 1000);
  }

  function runStartupDiscovery() {
    app.debug(`Startup discovery scheduled in ${optionsState.startupDiscoveryDelay} seconds...`);
    startupDiscoveryTimer = setTimeout(() => {
      app.debug('Running startup discovery...');
      onvifAdapter.startProbe(optionsState.ipAddress)
        .then((deviceList) => {
          discoveryService.processStartupDiscoveredDevices(deviceList);
        })
        .catch((error) => {
          app.debug('Startup discovery error:', error instanceof Error ? error.message : String(error));
        });
    }, (optionsState.startupDiscoveryDelay ?? 5) * 1000);
  }

  function attachWebSocketServer() {
    if (wsServer) {
      wsServer.close();
      wsServer = null;
    }
    if (upgradeHandler && app.server) {
      app.server.removeListener('upgrade', upgradeHandler);
      upgradeHandler = null;
    }
    if (!app.server) {
      app.debug('SignalK app.server not available - WebSocket disabled');
      return;
    }

    wsServer = new WebSocket.Server({ noServer: true });
    wsServer.on('connection', wsController.wsServerConnection);

    const activeWsServer = wsServer;
    upgradeHandler = (request, socket, head) => {
      let url;
      try {
        url = new URL(request.url || '/', 'ws://localhost');
      } catch (_error) {
        socket.destroy();
        return;
      }
      if (url.pathname === '/plugins/signalk-onvif-camera/ws') {
        activeWsServer.handleUpgrade(request, socket, head, (ws) => {
          activeWsServer.emit('connection', ws, request);
        });
      }
    };
    app.server.on('upgrade', upgradeHandler);
    app.debug('Onvif Camera WebSocket server attached to SignalK server');
  }

  plugin.start = function start(options) {
    optionsState = {
      ipAddress: options.ipAddress,
      userName: options.userName,
      password: options.password,
      autoDiscoveryInterval: options.autoDiscoveryInterval || 0,
      snapshotInterval: options.snapshotInterval || 100,
      enableSignalKIntegration: options.enableSignalKIntegration || false,
      discoverOnStart: options.discoverOnStart !== false,
      startupDiscoveryDelay: options.startupDiscoveryDelay || 5,
      cameraConfigs: buildCameraConfigs(options)
    };

    rebuildRuntimeServices();
    writeBrowserData();
    httpController.registerRoutes(plugin);
    attachWebSocketServer();

    if ((optionsState.autoDiscoveryInterval ?? 0) > 0) {
      setupAutoDiscovery();
    }
    if (optionsState.discoverOnStart) {
      runStartupDiscovery();
    }
  };

  plugin.stop = function stop() {
    discoveryService.reset();
    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
      autoDiscoveryTimer = null;
    }
    if (startupDiscoveryTimer) {
      clearTimeout(startupDiscoveryTimer);
      startupDiscoveryTimer = null;
    }
    mjpegManager.abortAll();
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

  return plugin;
};
