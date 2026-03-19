'use strict';

function createSignalKCameraPublisher({ app, pluginId, getCameraNickname }) {
  function publishDiscovery(address, connected) {
    if (!app.handleMessage) {
      return;
    }

    const nickname = getCameraNickname(address);
    app.handleMessage(pluginId, {
      updates: [{
        source: { label: pluginId },
        timestamp: new Date().toISOString(),
        values: [{
          path: `sensors.camera.${nickname}`,
          value: {
            address,
            discovered: true,
            connected
          }
        }]
      }]
    });
  }

  function publishCamera(address, deviceInfo) {
    if (!app.handleMessage) {
      return;
    }

    const nickname = getCameraNickname(address);
    const basePath = `sensors.camera.${nickname}`;
    const cameraData = {
      manufacturer: deviceInfo.Manufacturer || 'Unknown',
      model: deviceInfo.Model || 'Unknown',
      address,
      connected: true,
      snapshot: `/plugins/signalk-onvif-camera/snapshot?address=${encodeURIComponent(address)}`,
      mjpeg: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(address)}`
    };

    app.handleMessage(pluginId, {
      updates: [{
        source: { label: pluginId },
        timestamp: new Date().toISOString(),
        values: [{
          path: basePath,
          value: cameraData
        }]
      }]
    });
  }

  return {
    publishCamera,
    publishDiscovery
  };
}

module.exports = {
  createSignalKCameraPublisher
};
