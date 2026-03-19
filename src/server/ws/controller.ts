'use strict';

const WebSocket = require('ws');

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createWsController({ app, cameraService, discoveryService }) {
  function handleMessage(conn, message) {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      app.debug('Invalid JSON received from WebSocket:', getErrorMessage(error));
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(JSON.stringify({ error: 'Invalid JSON format' }));
      }
      return;
    }

    const params = data.params || {};
    switch (data.method) {
      case 'startDiscovery':
        discoveryService.startDiscovery(conn);
        break;
      case 'connect':
        cameraService.connect(conn, params);
        break;
      case 'fetchSnapshot':
        cameraService.fetchSnapshot(conn, params);
        break;
      case 'ptzMove':
        cameraService.ptzMove(conn, params);
        break;
      case 'ptzStop':
        cameraService.ptzStop(conn, params);
        break;
      case 'ptzHome':
        cameraService.ptzHome(conn, params);
        break;
      case 'getProfiles':
        cameraService.getProfiles(conn, params);
        break;
      case 'changeProfile':
        cameraService.changeProfile(conn, params);
        break;
      case 'getStreams':
        cameraService.getStreams(conn, params);
        break;
      case 'getDeviceInfo':
        cameraService.getDeviceInfo(conn, params);
        break;
      default:
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ error: `Unknown method: ${data.method}` }));
        }
    }
  }

  function wsServerConnection(conn) {
    conn.on('message', (message) => handleMessage(conn, message));
    conn.on('error', (error) => {
      app.debug('WebSocket error:', getErrorMessage(error));
    });
  }

  return {
    handleMessage,
    wsServerConnection
  };
}

module.exports = {
  createWsController
};
