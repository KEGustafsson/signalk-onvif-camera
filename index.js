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
process.chdir(__dirname);

const onvif = require('./lib/node-onvif.js');
const WebSocketServer = require('websocket').server;
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const devcert = require('devcert');
const { validateDeviceAddress, validatePTZCommand } = require('./lib/utils/validation');

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = 'signalk-onvif-camera';
  plugin.name = 'Signal K Onvif Camera Interface';
  plugin.description = 'Signal K Onvif Camera Interface';
  const setStatus = app.setPluginStatus || app.setProviderStatus;

  let ipAddress;
  let port;
  let secure;
  let wsServer;
  let webServer;
  let userName;
  let password;
  let certStatus = false;
  let startServer;
  let autoDiscoveryInterval;
  let autoDiscoveryTimer = null;
  let startupDiscoveryTimer = null;
  let snapshotInterval;
  let enableSignalKIntegration;
  let discoverOnStart;
  let startupDiscoveryDelay;
  let cameraConfigs = {};
  let mjpegStreams = new Map(); // Track active MJPEG streams

  plugin.start = function (options, _restartPlugin) {
    userName = options.userName;
    password = options.password;
    ipAddress = options.ipAddress;
    port = options.port;
    secure = options.secure;
    autoDiscoveryInterval = options.autoDiscoveryInterval || 0;
    snapshotInterval = options.snapshotInterval || 100;
    enableSignalKIntegration = options.enableSignalKIntegration || false;
    discoverOnStart = options.discoverOnStart !== false; // Default true
    startupDiscoveryDelay = options.startupDiscoveryDelay || 5;

    // Build camera-specific config map
    cameraConfigs = {};
    if (options.cameras && Array.isArray(options.cameras)) {
      options.cameras.forEach(cam => {
        if (cam.address) {
          // Sanitize nickname for Signal K path (alphanumeric and underscore only)
          const rawNickname = cam.nickname || cam.name || cam.address;
          const sanitizedNickname = rawNickname.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

          cameraConfigs[cam.address] = {
            name: cam.name || cam.address,
            nickname: sanitizedNickname,
            userName: cam.userName || userName,
            password: cam.password || password,
            defaultProfile: cam.defaultProfile || null
          };
        }
      });
    }

    const browserData = [{
      'secure': secure,
      'port': port,
      'snapshotInterval': snapshotInterval
    }];
    fs.writeFileSync(path.join(__dirname, 'public/browserdata.json'), JSON.stringify(browserData));

    if ((secure) && (!fs.existsSync('./cert'))){
      fs.mkdirSync('./cert');
      devcert.certificateFor([
        'localhost'
      ])
        .then(({ key, cert }) => {
          fs.writeFileSync(path.join(__dirname, 'cert/tls.key'), key);
          fs.writeFileSync(path.join(__dirname, 'cert/tls.cert'), cert);
          certStatus = true;
          console.log('SSL certificate generated successfully');
        })
        .catch((error) => {
          console.error('Failed to generate SSL certificate:', error.message);
          setStatus('Certificate generation failed. Server cannot start in secure mode.');
        });
    }

    try {
      if (fs.existsSync(path.join(__dirname, 'cert/tls.key'))) {
        certStatus = true;
      }
    } catch (error) {
      console.error('Error checking for certificate:', error.message);
      certStatus = false;
    }

    startServer = setInterval(() => {
      if (secure) {
        if (certStatus) {
          certStatus = false;
          clearInterval(startServer);
          const httpsSec = {
            key: fs.readFileSync(path.join(__dirname, 'cert/tls.key')),
            cert: fs.readFileSync(path.join(__dirname, 'cert/tls.cert'))
          };
          webServer = https.createServer(httpsSec, httpServerRequest);
          webServer.listen(port, () => {
            console.log(`Onvif Camera https/wss server running at 0.0.0.0:${port}`);
          });
          wsServer = new WebSocketServer({
            httpServer: webServer
          });
          wsServer.on('request', wsServerRequest);

          // Start auto-discovery timer if configured
          if (autoDiscoveryInterval > 0) {
            setupAutoDiscovery();
          }

          // Run startup discovery if enabled
          if (discoverOnStart) {
            runStartupDiscovery();
          }
        }
      } else {
        clearInterval(startServer);
        webServer = http.createServer(httpServerRequest);
        webServer.listen(port, () => {
          console.log(`Onvif Camera http/ws server running at 0.0.0.0:${port}`);
        });
        wsServer = new WebSocketServer({
          httpServer: webServer
        });
        wsServer.on('request', wsServerRequest);

        // Start auto-discovery timer if configured
        if (autoDiscoveryInterval > 0) {
          setupAutoDiscovery();
        }

        // Run startup discovery if enabled
        if (discoverOnStart) {
          runStartupDiscovery();
        }
      }
    }, 1000);
  };

  // Setup automatic periodic discovery
  function setupAutoDiscovery() {
    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
    }

    console.log(`Auto-discovery enabled: every ${autoDiscoveryInterval} seconds`);

    autoDiscoveryTimer = setInterval(() => {
      app.debug('Running auto-discovery...');
      onvif.startProbe(ipAddress)
        .then((device_list) => {
          device_list.forEach((device) => {
            const odevice = new onvif.OnvifDevice({
              xaddr: device.xaddrs[0]
            });
            const addr = odevice.address;
            if (!devices[addr]) {
              devices[addr] = odevice;
              app.debug(`Auto-discovered new camera: ${addr}`);

              // Publish discovery to Signal K if enabled
              if (enableSignalKIntegration && app.handleMessage) {
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
            }
          });
        })
        .catch((error) => {
          console.error('Auto-discovery error:', error.message);
        });
    }, autoDiscoveryInterval * 1000);
  }

  // Run discovery once at startup after a delay
  function runStartupDiscovery() {
    app.debug(`Startup discovery scheduled in ${startupDiscoveryDelay} seconds...`);

    startupDiscoveryTimer = setTimeout(() => {
      app.debug('Running startup discovery...');
      onvif.startProbe(ipAddress)
        .then((device_list) => {
          app.debug(`Startup discovery found ${device_list.length} device(s)`);
          device_list.forEach((device) => {
            const odevice = new onvif.OnvifDevice({
              xaddr: device.xaddrs[0]
            });
            const addr = odevice.address;
            if (!devices[addr]) {
              devices[addr] = odevice;
              app.debug(`Startup discovered camera: ${addr}`);
            }

            // Auto-connect pre-configured cameras and publish to Signal K
            const camConfig = cameraConfigs[addr];
            if (camConfig && enableSignalKIntegration) {
              // Set auth and initialize device
              odevice.setAuth(camConfig.userName, camConfig.password);
              odevice.init((error, result) => {
                if (error) {
                  app.debug(`Failed to initialize camera ${addr}: ${error.message}`);
                  return;
                }
                app.debug(`Auto-connected to pre-configured camera: ${addr}`);
                const currentProfile = odevice.getCurrentProfile();
                publishCameraToSignalK(addr, result, currentProfile);
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
          app.debug('Startup discovery error:', error.message);
        });
    }, startupDiscoveryDelay * 1000);
  }

  plugin.stop = function stop() {
    clearInterval(startServer);
    if (autoDiscoveryTimer) {
      clearInterval(autoDiscoveryTimer);
      autoDiscoveryTimer = null;
    }
    if (startupDiscoveryTimer) {
      clearTimeout(startupDiscoveryTimer);
      startupDiscoveryTimer = null;
    }
    // Clean up MJPEG streams
    mjpegStreams.forEach((stream, key) => {
      if (stream.timer) {
        clearInterval(stream.timer);
      }
    });
    mjpegStreams.clear();

    if (webServer) {
      wsServer.shutDown();
      webServer.close(() => {
        console.log('Onvif Camera server closed');
      });
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
      port: {
        type: 'number',
        title: 'Server port number',
        default: 8880
      },
      secure: {
        type: 'boolean',
        title: 'Use https/wss instead of http/ws'
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
            },
            defaultProfile: {
              type: 'string',
              title: 'Default media profile token (leave empty for auto)'
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

  function httpServerRequest(req, res) {
    const urlParts = require('url').parse(req.url, true);
    let reqPath = urlParts.pathname;

    // Handle MJPEG streaming endpoint
    if (reqPath === '/mjpeg') {
      handleMjpegStream(req, res, urlParts.query);
      return;
    }

    // Handle snapshot endpoint for direct HTTP access
    if (reqPath === '/snapshot') {
      handleSnapshotRequest(req, res, urlParts.query);
      return;
    }

    // Handle stream info endpoint
    if (reqPath === '/api/streams') {
      handleStreamInfoRequest(req, res, urlParts.query);
      return;
    }

    // Handle profiles endpoint
    if (reqPath === '/api/profiles') {
      handleProfilesRequest(req, res, urlParts.query);
      return;
    }

    if (reqPath.match(/\.{2,}/) || reqPath.match(/[^a-zA-Z\d_\-./]/)) {
      httpServerResponse404(req.url, res);
      return;
    }
    if (reqPath === '/') {
      reqPath = '/index.html';
    }
    const fpath = '.' + reqPath;
    fs.readFile(fpath, 'utf-8', function (err, data) {
      if (err) {
        httpServerResponse404(req.url, res);
        return;
      } else {
        const ctype = getContentType(fpath);
        res.writeHead(200, { 'Content-Type': ctype });
        res.write(data);
        res.end();
      }
    });
  }

  // MJPEG streaming handler
  function handleMjpegStream(req, res, query) {
    const address = query.address;
    const profileToken = query.profile;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing address parameter');
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    // If profile token specified, switch to that profile
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    const boundary = 'mjpegboundary';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache'
    });

    const streamId = `${address}-${Date.now()}`;
    let isActive = true;

    const sendFrame = () => {
      if (!isActive) return;

      device.fetchSnapshot((error, result) => {
        if (!isActive) return;

        if (!error && result && result.body) {
          const frame = result.body;
          const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;

          try {
            res.write(header);
            res.write(frame);
            res.write('\r\n');
          } catch (e) {
            isActive = false;
            return;
          }
        }

        if (isActive) {
          setTimeout(sendFrame, snapshotInterval);
        }
      });
    };

    mjpegStreams.set(streamId, { timer: null, res });

    req.on('close', () => {
      isActive = false;
      mjpegStreams.delete(streamId);
    });

    req.on('error', () => {
      isActive = false;
      mjpegStreams.delete(streamId);
    });

    sendFrame();
  }

  // Direct snapshot HTTP endpoint
  function handleSnapshotRequest(req, res, query) {
    const address = query.address;
    const profileToken = query.profile;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing address parameter');
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Device not found or not connected');
      return;
    }

    // If profile token specified, switch to that profile
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    device.fetchSnapshot((error, result) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to fetch snapshot: ' + error.message);
        return;
      }

      const ct = result.headers['content-type'] || 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': result.body.length,
        'Cache-Control': 'no-cache'
      });
      res.end(result.body);
    });
  }

  // Stream URIs endpoint
  function handleStreamInfoRequest(req, res, query) {
    const address = query.address;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing address parameter' }));
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device not found' }));
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ streams }));
  }

  // Profiles endpoint
  function handleProfilesRequest(req, res, query) {
    const address = query.address;
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing address parameter' }));
      return;
    }

    const device = devices[address];
    if (!device) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device not found' }));
      return;
    }

    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
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
    }));
  }

  function getContentType(fpath) {
    const ext = fpath.split('.').pop().toLowerCase();
    if (ext.match(/^(html|htm)$/)) {
      return 'text/html';
    } else if (ext.match(/^(jpeg|jpg)$/)) {
      return 'image/jpeg';
    } else if (ext.match(/^(png|gif)$/)) {
      return 'image/' + ext;
    } else if (ext === 'css') {
      return 'text/css';
    } else if (ext === 'js') {
      return 'text/javascript';
    } else if (ext === 'woff2') {
      return 'application/font-woff';
    } else if (ext === 'woff') {
      return 'application/font-woff';
    } else if (ext === 'ttf') {
      return 'application/font-ttf';
    } else if (ext === 'svg') {
      return 'image/svg+xml';
    } else if (ext === 'eot') {
      return 'application/vnd.ms-fontobject';
    } else if (ext === 'oft') {
      return 'application/x-font-otf';
    } else {
      return 'application/octet-stream';
    }
  }

  function httpServerResponse404(url, res) {
    res.write('404 Not Found: ' + url);
    res.end();
    console.log('HTTP : 404 Not Found : ' + url);
  }

  function wsServerRequest(request) {
    const conn = request.accept(null, request.origin);
    conn.on('message', function (message) {
      if (message.type !== 'utf8') {
        return;
      }
      try {
        const data = JSON.parse(message.utf8Data);
        const method = data['method'];
        const params = data['params'];
        if (method === 'startDiscovery') {
          startDiscovery(conn);
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
        }
      } catch (error) {
        console.error('Invalid JSON received from WebSocket:', error.message);
        if (conn.connected) {
          conn.send(JSON.stringify({ error: 'Invalid JSON format' }));
        }
      }
    });

    conn.on('close', function (_message) {});
    conn.on('error', function (error) {
      console.error('WebSocket error:', error);
    });
  }

  let devices = {};
  let deviceNames = {};
  function startDiscovery(conn) {
    onvif
      .startProbe(ipAddress)
      .then((device_list) => {
        // Clear devices only on successful new discovery
        devices = {};
        deviceNames = {};
        device_list.forEach((device) => {
          const odevice = new onvif.OnvifDevice({
            xaddr: device.xaddrs[0]
          });
          const addr = odevice.address;
          devices[addr] = odevice;
          deviceNames[addr] = (device.name).replace(/%20/g, ' ');
        });
        const devs = {};
        for (const addr in devices) {
          devs[addr] = {
            name: deviceNames[addr],
            address: addr
          };
        }
        const res = { id: 'startDiscovery', result: devs };
        if (conn.connected) conn.send(JSON.stringify(res));
      })
      .catch((error) => {
        // If discovery is in progress, return cached devices if available
        if (error.message === 'Discovery already in progress' && Object.keys(devices).length > 0) {
          app.debug('Discovery in progress, returning cached devices');
          const devs = {};
          for (const addr in devices) {
            devs[addr] = {
              name: deviceNames[addr] || addr,
              address: addr
            };
          }
          const res = { id: 'startDiscovery', result: devs };
          if (conn.connected) conn.send(JSON.stringify(res));
        } else if (error.message === 'Discovery already in progress') {
          // No cached devices, wait and retry once
          app.debug('Discovery in progress, waiting to retry...');
          setTimeout(() => {
            startDiscovery(conn);
          }, 3000);
        } else {
          const res = { id: 'startDiscovery', error: error.message };
          if (conn.connected) conn.send(JSON.stringify(res));
        }
      });
  }

  function connect(conn, params) {
    try {
      // Validate device address
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: 'connect',
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: 'connect',
        error: 'The specified device is not found: ' + params.address
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    // Use per-camera credentials if available, otherwise use defaults
    const camConfig = cameraConfigs[params.address];
    let authUser = userName;
    let authPass = password;

    if (camConfig) {
      authUser = camConfig.userName || userName;
      authPass = camConfig.password || password;
    }

    if (authUser) {
      params.user = authUser;
      params.pass = authPass;
      device.setAuth(params.user, params.pass);
    }

    device.init((error, result) => {
      const res = { id: 'connect' };
      if (error) {
        res['error'] = error.toString();
      } else {
        // Apply default profile if configured
        if (camConfig && camConfig.defaultProfile) {
          device.changeProfile(camConfig.defaultProfile);
        }

        // Include additional info in result
        const profiles = device.getProfileList();
        const currentProfile = device.getCurrentProfile();

        res['result'] = {
          ...result,
          profiles: profiles.map(p => ({
            token: p.token,
            name: p.name,
            resolution: p.video && p.video.encoder ? p.video.encoder.resolution : null,
            encoding: p.video && p.video.encoder ? p.video.encoder.encoding : null
          })),
          currentProfile: currentProfile ? currentProfile.token : null,
          streams: currentProfile ? currentProfile.stream : null,
          mjpegUrl: `/mjpeg?address=${encodeURIComponent(params.address)}${currentProfile ? '&profile=' + encodeURIComponent(currentProfile.token) : ''}`,
          snapshotUrl: `/snapshot?address=${encodeURIComponent(params.address)}${currentProfile ? '&profile=' + encodeURIComponent(currentProfile.token) : ''}`
        };

        // Publish to Signal K if enabled
        if (enableSignalKIntegration) {
          publishCameraToSignalK(params.address, result, currentProfile);
        }
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  // Get available profiles for a device
  function getProfiles(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = { id: 'getProfiles', error: error.message };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = { id: 'getProfiles', error: 'Device not found' };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();

    const res = {
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
    if (conn.connected) conn.send(JSON.stringify(res));
  }

  // Change the active profile for a device
  function changeProfile(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = { id: 'changeProfile', error: error.message };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = { id: 'changeProfile', error: 'Device not found' };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const profileToken = params.token || params.index;
    const newProfile = device.changeProfile(profileToken);

    if (newProfile) {
      const res = {
        id: 'changeProfile',
        result: {
          token: newProfile.token,
          name: newProfile.name,
          stream: newProfile.stream,
          snapshot: newProfile.snapshot,
          video: newProfile.video
        }
      };
      if (conn.connected) conn.send(JSON.stringify(res));
    } else {
      const res = { id: 'changeProfile', error: 'Profile not found: ' + profileToken };
      if (conn.connected) conn.send(JSON.stringify(res));
    }
  }

  // Get stream URIs for a device
  function getStreams(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = { id: 'getStreams', error: error.message };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = { id: 'getStreams', error: 'Device not found' };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const currentProfile = device.getCurrentProfile();
    if (!currentProfile) {
      const res = { id: 'getStreams', error: 'No profile selected' };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const res = {
      id: 'getStreams',
      result: {
        profile: currentProfile.name,
        rtsp: currentProfile.stream.rtsp,
        http: currentProfile.stream.http,
        udp: currentProfile.stream.udp,
        snapshot: currentProfile.snapshot,
        mjpeg: `/mjpeg?address=${encodeURIComponent(params.address)}`
      }
    };
    if (conn.connected) conn.send(JSON.stringify(res));
  }

  // Get detailed device info
  function getDeviceInfo(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = { id: 'getDeviceInfo', error: error.message };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = { id: 'getDeviceInfo', error: 'Device not found' };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const info = device.getInformation();
    const profiles = device.getProfileList();
    const currentProfile = device.getCurrentProfile();
    const hasPtz = !!device.services.ptz;
    const hasEvents = !!device.services.events;

    const res = {
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
    if (conn.connected) conn.send(JSON.stringify(res));
  }

  // Get nickname for a camera address
  function getCameraNickname(address) {
    const camConfig = cameraConfigs[address];
    if (camConfig && camConfig.nickname) {
      return camConfig.nickname;
    }
    // Fallback: convert IP to safe path name
    return address.replace(/\./g, '_');
  }

  // Publish camera info to Signal K with nested values
  function publishCameraToSignalK(address, deviceInfo, profile) {
    if (!app.handleMessage) return;

    const nickname = getCameraNickname(address);
    const basePath = `sensors.camera.${nickname}`;

    // Build nested value object
    const cameraData = {
      manufacturer: deviceInfo.Manufacturer || 'Unknown',
      model: deviceInfo.Model || 'Unknown',
      address: address,
      connected: true
    };

    // Add stream info if available
    if (profile && profile.stream) {
      cameraData.stream = {
        rtsp: profile.stream.rtsp || null,
        http: profile.stream.http || null,
        udp: profile.stream.udp || null
      };
    }

    // Add resolution info if available
    if (profile && profile.video && profile.video.encoder) {
      cameraData.resolution = {
        width: profile.video.encoder.resolution.width,
        height: profile.video.encoder.resolution.height
      };
      cameraData.encoding = profile.video.encoder.encoding || null;
      cameraData.framerate = profile.video.encoder.framerate || null;
      cameraData.bitrate = profile.video.encoder.bitrate || null;
    }

    // Add profile name if available
    if (profile) {
      cameraData.profile = profile.name || null;
    }

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

  function fetchSnapshot(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: 'fetchSnapshot',
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: 'fetchSnapshot',
        error: 'The specified device is not found: ' + params.address
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.fetchSnapshot((error, result) => {
      const res = { id: 'fetchSnapshot' };
      if (error) {
        res['error'] = error.toString();
      } else {
        const ct = result['headers']['content-type'];
        const buffer = result['body'];
        const b64 = buffer.toString('base64');
        const uri = 'data:' + ct + ';base64,' + b64;
        res['result'] = uri;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzMove(conn, params) {
    try {
      validatePTZCommand(params);
    } catch (error) {
      const res = {
        id: 'ptzMove',
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: 'ptzMove',
        error: 'The specified device is not found: ' + params.address
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.ptzMove(params, (error) => {
      const res = { id: 'ptzMove' };
      if (error) {
        res['error'] = error.toString();
      } else {
        res['result'] = true;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzStop(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: 'ptzStop',
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: 'ptzStop',
        error: 'The specified device is not found: ' + params.address
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.ptzStop((error) => {
      const res = { id: 'ptzStop' };
      if (error) {
        res['error'] = error.toString();
      } else {
        res['result'] = true;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzHome(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: 'ptzHome',
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: 'ptzHome',
        error: 'The specified device is not found: ' + params.address
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    if (!device.services.ptz) {
      const res = {
        id: 'ptzHome',
        error: 'The specified device does not support PTZ.'
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const ptz = device.services.ptz;
    const profile = device.getCurrentProfile();
    const ptzParams = {
      ProfileToken: profile['token'],
      Speed: 1
    };
    ptz.gotoHomePosition(ptzParams, (error, _result) => {
      const res = { id: 'ptzHome' };
      if (error) {
        res['error'] = error.toString();
      } else {
        res['result'] = true;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  // Store plugin instance for graceful shutdown
  if (!global.__onvifPluginInstances) {
    global.__onvifPluginInstances = [];
  }
  global.__onvifPluginInstances.push(plugin);

  return plugin;
};

// Graceful shutdown handling
let shutdownInProgress = false;

function gracefulShutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop all plugin instances
  if (global.__onvifPluginInstances) {
    global.__onvifPluginInstances.forEach((plugin) => {
      if (plugin && typeof plugin.stop === 'function') {
        try {
          plugin.stop();
        } catch (error) {
          console.error('Error stopping plugin:', error.message);
        }
      }
    });
  }

  // Give servers time to close gracefully
  setTimeout(() => {
    console.log('Shutdown complete');
    process.exit(0);
  }, 1000);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});
