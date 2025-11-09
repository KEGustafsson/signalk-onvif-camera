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

"use strict";
process.chdir(__dirname);

const onvif = require("./lib/node-onvif.js");
const WebSocketServer = require("websocket").server;
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const devcert = require('devcert');
const { validateDeviceAddress, validatePTZCommand, ValidationError } = require('./lib/utils/validation');

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = "signalk-onvif-camera";
  plugin.name = "Signal K Onvif Camera Interface";
  plugin.description = "Signal K Onvif Camera Interface";
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

  plugin.start = function (options, restartPlugin) {
    userName = options.userName;
    password = options.password;
    ipAddress = options.ipAddress;
    port = options.port;
    secure = options.secure;
    const browserData = [{"secure": secure,"port": port}];
    fs.writeFileSync(path.join(__dirname, 'public/browserdata.json'), JSON.stringify(browserData));
    
    if ((secure) && (!fs.existsSync('./cert'))){
      fs.mkdirSync('./cert');
      devcert.certificateFor([
        'localhost'
      ])
      .then(({key, cert}) => {
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
            cert: fs.readFileSync(path.join(__dirname, 'cert/tls.cert')),
          };
          webServer = https.createServer(httpsSec, httpServerRequest);
          webServer.listen(port, () => {
            console.log(`Onvif Camera https/wss server running at 0.0.0.0:${port}`);
          });
          wsServer = new WebSocketServer({
            httpServer: webServer,
          });
          wsServer.on('request', wsServerRequest);
        }
      } else {
        clearInterval(startServer);
        webServer = http.createServer(httpServerRequest);
        webServer.listen(port, () => {
          console.log(`Onvif Camera http/ws server running at 0.0.0.0:${port}`);
        });
        wsServer = new WebSocketServer({
          httpServer: webServer,
        });
        wsServer.on('request', wsServerRequest);
      }
    }, 1000);
  };

  plugin.stop = function stop() {
    clearInterval(startServer);
    if (webServer) {
      wsServer.shutDown();
      webServer.close(() => {
        console.log("Onvif Camera server closed");
      });
    }
  };

  plugin.uiSchema = {
    //hide password from ui
    password: {
      'ui:widget': 'password'
    },
  }

  plugin.schema = {
    type: "object",
    title: 'Onvif Camera Interface',
    description: 'Make an ONVIF user profile to camera(s) and add camera(s) IP below',
    properties: {
      ipAddress: {
        type: 'string',
        title: 'IP address of LAN, where ONVIF devices are located. Default, leave empty.',
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
        title: 'ONVIF username for camera(s)'
      },
      password: {
        type: 'string',
        title: 'ONVIF password for camera(s)'
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
          },
        },
      },
    },
  };

  function httpServerRequest(req, res) {
    var path = req.url.replace(/\?.*$/, "");
    if (path.match(/\.{2,}/) || path.match(/[^a-zA-Z\d\_\-\.\/]/)) {
      httpServerResponse404(req.url, res);
      return;
    }
    if (path === "/") {
      path = "/index.html";
    }
    var fpath = "." + path;
    fs.readFile(fpath, "utf-8", function (err, data) {
      if (err) {
        httpServerResponse404(req.url, res);
        return;
      } else {
        var ctype = getContentType(fpath);
        res.writeHead(200, { "Content-Type": ctype });
        res.write(data);
        res.end();
      }
    });
  }

  function getContentType(fpath) {
    var ext = fpath.split(".").pop().toLowerCase();
    if (ext.match(/^(html|htm)$/)) {
      return "text/html";
    } else if (ext.match(/^(jpeg|jpg)$/)) {
      return "image/jpeg";
    } else if (ext.match(/^(png|gif)$/)) {
      return "image/" + ext;
    } else if (ext === "css") {
      return "text/css";
    } else if (ext === "js") {
      return "text/javascript";
    } else if (ext === "woff2") {
      return "application/font-woff";
    } else if (ext === "woff") {
      return "application/font-woff";
    } else if (ext === "ttf") {
      return "application/font-ttf";
    } else if (ext === "svg") {
      return "image/svg+xml";
    } else if (ext === "eot") {
      return "application/vnd.ms-fontobject";
    } else if (ext === "oft") {
      return "application/x-font-otf";
    } else {
      return "application/octet-stream";
    }
  }

  function httpServerResponse404(url, res) {
    res.write("404 Not Found: " + url);
    res.end();
    console.log("HTTP : 404 Not Found : " + url);
  }

  function wsServerRequest(request) {
    var conn = request.accept(null, request.origin);
    conn.on("message", function (message) {
      if (message.type !== "utf8") {
        return;
      }
      try {
        var data = JSON.parse(message.utf8Data);
        var method = data["method"];
        var params = data["params"];
        if (method === "startDiscovery") {
          startDiscovery(conn);
        } else if (method === "connect") {
          connect(conn, params);
        } else if (method === "fetchSnapshot") {
          fetchSnapshot(conn, params);
        } else if (method === "ptzMove") {
          ptzMove(conn, params);
        } else if (method === "ptzStop") {
          ptzStop(conn, params);
        } else if (method === "ptzHome") {
          ptzHome(conn, params);
        }
      } catch (error) {
        console.error("Invalid JSON received from WebSocket:", error.message);
        if (conn.connected) {
          conn.send(JSON.stringify({ error: "Invalid JSON format" }));
        }
      }
    });

    conn.on("close", function (message) {});
    conn.on("error", function (error) {
      console.error("WebSocket error:", error);
    });
  }

  var devices = {};
  function startDiscovery(conn) {
    devices = {};
    let names = {};
    onvif
      .startProbe(ipAddress)
      .then((device_list) => {
        device_list.forEach((device) => {
          let odevice = new onvif.OnvifDevice({
            xaddr: device.xaddrs[0],
          });
          let addr = odevice.address;
          devices[addr] = odevice;
          names[addr] = (device.name).replace(/%20/g, " ");
        });
        var devs = {};
        for (var addr in devices) {
          devs[addr] = {
            name: names[addr],
            address: addr,
          };
        }
        let res = { id: "startDiscovery", result: devs };
        if (conn.connected) conn.send(JSON.stringify(res));
      })
      .catch((error) => {
        let res = { id: "connect", error: error.message };
        if (conn.connected) conn.send(JSON.stringify(res));
      });
  }

  function connect(conn, params) {
    try {
      // Validate device address
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: "connect",
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: "connect",
        error: "The specified device is not found: " + params.address,
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    if (userName) {
      params.user = userName;
      params.pass = password;
      device.setAuth(params.user, params.pass);
    }

    device.init((error, result) => {
      const res = { id: "connect" };
      if (error) {
        res["error"] = error.toString();
      } else {
        res["result"] = result;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function fetchSnapshot(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: "fetchSnapshot",
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: "fetchSnapshot",
        error: "The specified device is not found: " + params.address,
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.fetchSnapshot((error, result) => {
      const res = { id: "fetchSnapshot" };
      if (error) {
        res["error"] = error.toString();
      } else {
        const ct = result["headers"]["content-type"];
        const buffer = result["body"];
        const b64 = buffer.toString("base64");
        const uri = "data:" + ct + ";base64," + b64;
        res["result"] = uri;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzMove(conn, params) {
    try {
      validatePTZCommand(params);
    } catch (error) {
      const res = {
        id: "ptzMove",
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: "ptzMove",
        error: "The specified device is not found: " + params.address,
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.ptzMove(params, (error) => {
      const res = { id: "ptzMove" };
      if (error) {
        res["error"] = error.toString();
      } else {
        res["result"] = true;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzStop(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: "ptzStop",
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: "ptzStop",
        error: "The specified device is not found: " + params.address,
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    device.ptzStop((error) => {
      const res = { id: "ptzStop" };
      if (error) {
        res["error"] = error.toString();
      } else {
        res["result"] = true;
      }
      if (conn.connected) conn.send(JSON.stringify(res));
    });
  }

  function ptzHome(conn, params) {
    try {
      validateDeviceAddress(params.address);
    } catch (error) {
      const res = {
        id: "ptzHome",
        error: error.message
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const device = devices[params.address];
    if (!device) {
      const res = {
        id: "ptzHome",
        error: "The specified device is not found: " + params.address,
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }
    if (!device.services.ptz) {
      const res = {
        id: "ptzHome",
        error: "The specified device does not support PTZ.",
      };
      if (conn.connected) conn.send(JSON.stringify(res));
      return;
    }

    const ptz = device.services.ptz;
    const profile = device.getCurrentProfile();
    const ptzParams = {
      ProfileToken: profile["token"],
      Speed: 1,
    };
    ptz.gotoHomePosition(ptzParams, (error, result) => {
      const res = { id: "ptzHome" };
      if (error) {
        res["error"] = error.toString();
      } else {
        res["result"] = true;
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
