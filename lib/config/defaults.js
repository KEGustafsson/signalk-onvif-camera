/**
 * Default configuration values for the ONVIF plugin
 */

module.exports = {
  server: {
    defaultPort: 8880,
    maxConnections: 100
  },

  discovery: {
    interval: 150,      // milliseconds between probe sends
    retryMax: 3,        // number of retries
    wait: 3000,         // milliseconds to wait for responses
    multicastAddress: '239.255.255.250',
    port: 3702
  },

  snapshot: {
    defaultInterval: 1000,  // milliseconds
    maxSize: 10485760,      // 10MB
    timeout: 5000
  },

  ptz: {
    defaultSpeed: 1.0,
    defaultTimeout: 30,     // seconds
    minSpeed: -1.0,
    maxSpeed: 1.0
  },

  certificate: {
    path: './cert',
    checkInterval: 1000,    // milliseconds
    maxRetries: 30
  },

  http: {
    timeout: 3000           // milliseconds
  },

  websocket: {
    pingInterval: 30000,    // milliseconds
    pongTimeout: 5000       // milliseconds
  }
};
