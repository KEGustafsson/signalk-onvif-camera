'use strict';

const { validateDeviceAddress } = require('../../../lib/utils/validation');
const { authorizeRequest } = require('../security/authorize-request');

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createHttpController({ app, cameraService, mjpegManager }) {
  function handleMjpegStream(req, res, query) {
    if (!authorizeRequest(app, req, res)) return;

    const address = query.address;
    const profileToken = query.profile;
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

    const device = cameraService.getDevice(address);
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    if (profileToken) {
      device.changeProfile(profileToken);
    }

    mjpegManager.startStream({ address, device, req, res });
  }

  function handleSnapshotRequest(req, res, query) {
    if (!authorizeRequest(app, req, res)) return;

    const address = query.address;
    const profileToken = query.profile;
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

    const device = cameraService.getDevice(address);
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    if (profileToken) {
      device.changeProfile(profileToken);
    }

    device.fetchSnapshot((error, result) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Failed to fetch snapshot: ${getErrorMessage(error)}`);
        return;
      }
      if (!result || !result.body) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Snapshot returned no data');
        return;
      }
      const contentType = (result.headers && result.headers['content-type']) || 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': result.body.length,
        'Cache-Control': 'no-cache'
      });
      res.end(result.body);
    });
  }

  function handleStreamInfoRequest(req, res, query) {
    if (!authorizeRequest(app, req, res)) return;

    const address = query.address;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing address parameter' }));
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getErrorMessage(error) }));
      return;
    }
    const device = cameraService.getDevice(address);
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device not found' }));
      return;
    }
    const streams = device.getProfileList().map((profile) => ({
      name: profile.name,
      token: profile.token,
      rtsp: profile.stream.rtsp,
      http: profile.stream.http,
      udp: profile.stream.udp,
      snapshot: profile.snapshot,
      video: profile.video,
      audio: profile.audio
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ streams }));
  }

  function handleProfilesRequest(req, res, query) {
    if (!authorizeRequest(app, req, res)) return;

    const address = query.address;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing address parameter' }));
      return;
    }
    try {
      validateDeviceAddress(address);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getErrorMessage(error) }));
      return;
    }
    const device = cameraService.getDevice(address);
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device not found' }));
      return;
    }
    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profiles: profiles.map((profile) => ({
        token: profile.token,
        name: profile.name,
        resolution: profile.video && profile.video.encoder ? {
          width: profile.video.encoder.resolution.width,
          height: profile.video.encoder.resolution.height
        } : null,
        framerate: profile.video && profile.video.encoder ? profile.video.encoder.framerate : null,
        encoding: profile.video && profile.video.encoder ? profile.video.encoder.encoding : null
      })),
      current: currentProfile ? currentProfile.token : null
    }));
  }

  function registerRoutes(plugin) {
    if (plugin._routesRegistered || typeof app.get !== 'function') {
      return;
    }

    app.get('/plugins/signalk-onvif-camera/mjpeg', (req, res) => {
      if (mjpegManager.isAtCapacity()) {
        res.status(503).json({ error: 'Too many active streams' });
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

  return {
    handleMjpegStream,
    handleProfilesRequest,
    handleSnapshotRequest,
    handleStreamInfoRequest,
    registerRoutes
  };
}

module.exports = {
  createHttpController
};
