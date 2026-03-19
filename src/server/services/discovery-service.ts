'use strict';

function createDiscoveryService({ app, onvifAdapter, enableSignalKIntegration, cameraConfigs, publisher, getProbeIpAddress }) {
  const state = {
    devices: {},
    deviceNames: {},
    retryTimer: null as ReturnType<typeof setTimeout> | null,
    pendingConnections: [] as Array<{ readyState: number; send(message: string): void }>
  };

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function rememberDiscoveredDevices(deviceList) {
    deviceList.forEach((device) => {
      const onvifDevice = onvifAdapter.createDevice(device);
      const address = onvifDevice.address;
      const deviceName = (device.name || address).replace(/%20/g, ' ');

      if (!state.devices[address]) {
        state.devices[address] = onvifDevice;
      }
      state.deviceNames[address] = deviceName;
    });
  }

  function buildDiscoveredDeviceMap() {
    const result = {};
    Object.keys(state.devices).forEach((address) => {
      result[address] = {
        name: state.deviceNames[address] || address,
        address
      };
    });
    return result;
  }

  function notifyConnections(connections, payload) {
    connections.forEach((conn) => {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify(payload));
      }
    });
  }

  function handleProbeSuccess(conn, deviceList) {
    rememberDiscoveredDevices(deviceList);
    notifyConnections([conn, ...state.pendingConnections], {
      id: 'startDiscovery',
      result: buildDiscoveredDeviceMap()
    });
    state.pendingConnections = [];
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
  }

  function handleProbeError(conn, error) {
    if (onvifAdapter.isProbeInProgress() && Object.keys(state.devices).length > 0) {
      app.debug('Discovery in progress, returning cached devices');
      notifyConnections([conn], {
        id: 'startDiscovery',
        result: buildDiscoveredDeviceMap()
      });
      return;
    }

    if (onvifAdapter.isProbeInProgress()) {
      state.pendingConnections.push(conn);
      if (!state.retryTimer) {
        app.debug('Discovery in progress, scheduling shared retry...');
        state.retryTimer = setTimeout(() => {
          state.retryTimer = null;
          const pending = state.pendingConnections.splice(0);
          if (pending.length > 0) {
            state.pendingConnections = pending.slice(1);
            startDiscovery(pending[0]);
          }
        }, 3000);
      }
      return;
    }

    notifyConnections([conn], {
      id: 'startDiscovery',
      error: getErrorMessage(error)
    });
  }

  function startDiscovery(conn) {
    onvifAdapter.startProbe(getProbeIpAddress ? getProbeIpAddress() : undefined).then((deviceList) => handleProbeSuccess(conn, deviceList)).catch((error) => handleProbeError(conn, error));
  }

  function discoverConfiguredDevices(ipAddress) {
    return onvifAdapter.startProbe(ipAddress).then((deviceList) => {
      rememberDiscoveredDevices(deviceList);
      return deviceList;
    });
  }

  function processAutoDiscoveredDevices(deviceList) {
    deviceList.forEach((device) => {
      try {
        const onvifDevice = onvifAdapter.createDevice(device);
        const address = onvifDevice.address;
        const deviceName = (device.name || address).replace(/%20/g, ' ');

        if (!state.devices[address]) {
          state.devices[address] = onvifDevice;
          state.deviceNames[address] = deviceName;
          app.debug(`Auto-discovered new camera: ${deviceName} (${address})`);

          if (enableSignalKIntegration) {
            publisher.publishDiscovery(address, false);
          }
        }
      } catch (error) {
        app.debug(`Auto-discovery: error processing device: ${getErrorMessage(error)}`);
      }
    });
  }

  function processStartupDiscoveredDevices(deviceList) {
    app.debug(`Startup discovery found ${deviceList.length} device(s)`);
    deviceList.forEach((device) => {
      try {
        const onvifDevice = onvifAdapter.createDevice(device);
        const address = onvifDevice.address;
        const deviceName = (device.name || address).replace(/%20/g, ' ');

        if (!state.devices[address]) {
          state.devices[address] = onvifDevice;
          state.deviceNames[address] = deviceName;
          app.debug(`Startup discovered camera: ${deviceName} (${address})`);
        }

        const cameraConfig = cameraConfigs[address];
        if (cameraConfig && enableSignalKIntegration) {
          onvifDevice.setAuth(cameraConfig.userName, cameraConfig.password);
          onvifDevice.init((error, result) => {
            if (error) {
              app.debug(`Failed to initialize camera ${address}: ${error.message}`);
              return;
            }
            try {
              app.debug(`Auto-connected to pre-configured camera: ${address}`);
              publisher.publishCamera(address, result);
            } catch (publishError) {
              app.debug(`Error publishing camera ${address} to Signal K: ${getErrorMessage(publishError)}`);
            }
          });
        } else if (enableSignalKIntegration) {
          publisher.publishDiscovery(address, false);
        }
      } catch (error) {
        app.debug(`Startup discovery: error processing device: ${getErrorMessage(error)}`);
      }
    });
  }

  function reset() {
    state.devices = {};
    state.deviceNames = {};
    state.pendingConnections = [];
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
  }

  return {
    state,
    buildDiscoveredDeviceMap,
    discoverConfiguredDevices,
    processAutoDiscoveredDevices,
    processStartupDiscoveredDevices,
    reset,
    startDiscovery
  };
}

module.exports = {
  createDiscoveryService
};
