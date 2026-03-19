'use strict';

const { validateDeviceAddress, validatePTZCommand } = require('../../../lib/utils/validation');

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createCameraService({ app, cameraConfigs, defaultCredentials, devices, publisher, enableSignalKIntegration }) {
  function getDevice(address) {
    return devices[address];
  }

  function getCameraNickname(address) {
    const cameraConfig = cameraConfigs[address];
    if (cameraConfig && cameraConfig.nickname) {
      return cameraConfig.nickname;
    }
    return address.replace(/\./g, '_');
  }

  function resolveCredentials(address, params) {
    const cameraConfig = cameraConfigs[address];
    const user = (cameraConfig && cameraConfig.userName) || defaultCredentials.userName;
    const pass = (cameraConfig && cameraConfig.password) || defaultCredentials.password;
    if (user) {
      params.user = user;
      params.pass = pass;
    }
    return params;
  }

  function withValidatedAddress(id, conn, params, callback) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify({ id, error: getErrorMessage(error) }));
      }
      return;
    }

    const device = getDevice(params.address);
    if (!device) {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify({ id, error: `The specified device is not found: ${params.address}` }));
      }
      return;
    }

    callback(device);
  }

  function connect(conn, params) {
    withValidatedAddress('connect', conn, params, (device) => {
      const credentials = resolveCredentials(params.address, params);
      if (credentials.user) {
        device.setAuth(credentials.user, credentials.pass);
      }

      device.init((error, result) => {
        const response: { id: string; error?: string; result?: unknown } = { id: 'connect' };
        if (error) {
          response.error = getErrorMessage(error);
        } else {
          const currentProfile = device.getCurrentProfile();
          response.result = {
            ...result,
            streams: currentProfile ? currentProfile.stream : null,
            mjpegUrl: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(params.address)}`,
            snapshotUrl: `/plugins/signalk-onvif-camera/snapshot?address=${encodeURIComponent(params.address)}`
          };
          if (enableSignalKIntegration) {
            publisher.publishCamera(params.address, result);
          }
        }
        if (conn.readyState === 1) {
          conn.send(JSON.stringify(response));
        }
      });
    });
  }

  function fetchSnapshot(conn, params) {
    withValidatedAddress('fetchSnapshot', conn, params, (device) => {
      if (params.profile) {
        device.changeProfile(params.profile);
      }

      const currentProfile = device.getCurrentProfile();
      if (currentProfile) {
        app.debug(`Fetching snapshot - profile: ${currentProfile.name} (${currentProfile.token}), snapshot URL: ${currentProfile.snapshot}`);
      }

      device.fetchSnapshot((error, result) => {
        const response: { id: string; error?: string; result?: unknown } = { id: 'fetchSnapshot' };
        if (error) {
          response.error = getErrorMessage(error);
        } else if (!result || !result.body) {
          response.error = 'Snapshot returned no data';
        } else {
          const contentType = (result.headers && result.headers['content-type']) || 'image/jpeg';
          response.result = `data:${contentType};base64,${result.body.toString('base64')}`;
        }
        if (conn.readyState === 1) {
          conn.send(JSON.stringify(response));
        }
      });
    });
  }

  function getProfiles(conn, params) {
    withValidatedAddress('getProfiles', conn, params, (device) => {
      const profiles = device.getProfileList();
      const currentProfile = device.getCurrentProfile();
      const response = {
        id: 'getProfiles',
        result: {
          profiles: profiles.map((profile) => ({
            token: profile.token,
            name: profile.name,
            resolution: profile.video && profile.video.encoder ? {
              width: profile.video.encoder.resolution.width,
              height: profile.video.encoder.resolution.height
            } : null,
            framerate: profile.video && profile.video.encoder ? profile.video.encoder.framerate : null,
            bitrate: profile.video && profile.video.encoder ? profile.video.encoder.bitrate : null,
            encoding: profile.video && profile.video.encoder ? profile.video.encoder.encoding : null
          })),
          current: currentProfile ? currentProfile.token : null
        }
      };
      if (conn.readyState === 1) {
        conn.send(JSON.stringify(response));
      }
    });
  }

  function changeProfile(conn, params) {
    withValidatedAddress('changeProfile', conn, params, (device) => {
      const profileToken = params.token || params.index;
      app.debug(`Changing profile for ${params.address} to token: ${profileToken}`);
      const newProfile = device.changeProfile(profileToken);
      if (conn.readyState !== 1) {
        return;
      }
      if (!newProfile) {
        app.debug(`Profile change failed - profile not found: ${profileToken}`);
        conn.send(JSON.stringify({ id: 'changeProfile', error: `Profile not found: ${profileToken}` }));
        return;
      }
      app.debug(`Profile changed successfully. New profile: ${newProfile.name}, token: ${newProfile.token}`);
      conn.send(JSON.stringify({
        id: 'changeProfile',
        result: {
          token: newProfile.token,
          name: newProfile.name,
          stream: newProfile.stream,
          snapshot: newProfile.snapshot,
          video: newProfile.video
        }
      }));
    });
  }

  function getStreams(conn, params) {
    withValidatedAddress('getStreams', conn, params, (device) => {
      const currentProfile = device.getCurrentProfile();
      if (conn.readyState !== 1) {
        return;
      }
      if (!currentProfile) {
        conn.send(JSON.stringify({ id: 'getStreams', error: 'No profile selected' }));
        return;
      }
      conn.send(JSON.stringify({
        id: 'getStreams',
        result: {
          profile: currentProfile.name,
          rtsp: currentProfile.stream.rtsp,
          http: currentProfile.stream.http,
          udp: currentProfile.stream.udp,
          snapshot: currentProfile.snapshot,
          mjpeg: `/plugins/signalk-onvif-camera/mjpeg?address=${encodeURIComponent(params.address)}`
        }
      }));
    });
  }

  function getDeviceInfo(conn, params) {
    withValidatedAddress('getDeviceInfo', conn, params, (device) => {
      const info = device.getInformation();
      const profiles = device.getProfileList();
      const currentProfile = device.getCurrentProfile();
      const response = {
        id: 'getDeviceInfo',
        result: {
          info,
          hasPtz: !!device.services.ptz,
          hasEvents: !!device.services.events,
          profileCount: profiles.length,
          currentProfile: currentProfile ? { token: currentProfile.token, name: currentProfile.name } : null
        }
      };
      if (conn.readyState === 1) {
        conn.send(JSON.stringify(response));
      }
    });
  }

  function ptzMove(conn, params) {
    try {
      validatePTZCommand(params);
    } catch (error) {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify({ id: 'ptzMove', error: getErrorMessage(error) }));
      }
      return;
    }
    const device = getDevice(params.address);
    if (!device) {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify({ id: 'ptzMove', error: `The specified device is not found: ${params.address}` }));
      }
      return;
    }
    device.ptzMove(params, (error) => {
      if (conn.readyState === 1) {
        conn.send(JSON.stringify(error ? { id: 'ptzMove', error: error.toString() } : { id: 'ptzMove', result: true }));
      }
    });
  }

  function ptzStop(conn, params) {
    withValidatedAddress('ptzStop', conn, params, (device) => {
      device.ptzStop((error) => {
        if (conn.readyState === 1) {
          conn.send(JSON.stringify(error ? { id: 'ptzStop', error: error.toString() } : { id: 'ptzStop', result: true }));
        }
      });
    });
  }

  function ptzHome(conn, params) {
    withValidatedAddress('ptzHome', conn, params, (device) => {
      if (conn.readyState !== 1) {
        return;
      }
      if (!device.services.ptz) {
        conn.send(JSON.stringify({ id: 'ptzHome', error: 'The specified device does not support PTZ.' }));
        return;
      }
      const profile = device.getCurrentProfile();
      if (!profile) {
        conn.send(JSON.stringify({ id: 'ptzHome', error: 'No media profile selected' }));
        return;
      }
      device.services.ptz.gotoHomePosition({ ProfileToken: profile.token, Speed: 1 }, (error) => {
        if (conn.readyState === 1) {
          conn.send(JSON.stringify(error ? { id: 'ptzHome', error: error.toString() } : { id: 'ptzHome', result: true }));
        }
      });
    });
  }

  return {
    changeProfile,
    connect,
    fetchSnapshot,
    getCameraNickname,
    getDevice,
    getDeviceInfo,
    getProfiles,
    getStreams,
    ptzHome,
    ptzMove,
    ptzStop
  };
}

module.exports = {
  createCameraService
};
