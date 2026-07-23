#!/usr/bin/env node
/**
 * Example: driving an ONVIF PTZ camera through the signalk-onvif-camera
 * PUT API.
 *
 * The plugin registers Signal K PUT handlers on three paths (context
 * `vessels.self`):
 *
 *   sensors.camera.ptz.move  -> continuous pan/tilt/zoom
 *   sensors.camera.ptz.stop  -> stop pan/tilt/zoom
 *   sensors.camera.ptz.home  -> go to the camera's home position
 *
 * Over HTTP these become PUT requests to
 *   /signalk/v1/api/vessels/self/sensors/camera/ptz/{move,stop,home}
 * with a JSON body of the form { "value": <command> } where <command>
 * carries the target camera's IP address plus any command parameters.
 *
 * This script is a plain Node.js program (no dependencies) that uses the
 * built-in global `fetch`, so it needs Node.js 18 or newer — the same
 * baseline the plugin requires. Run it from anywhere that can reach your
 * Signal K server; it does NOT have to run on the server itself.
 *
 * Usage:
 *   node examples/ptz-control.js
 *
 * Configuration is read from environment variables (with sensible
 * defaults) so you don't have to edit the file:
 *
 *   SIGNALK_URL     Base URL of the Signal K server
 *                   (default: http://localhost:3000)
 *   CAMERA_ADDRESS  IP address of the ONVIF camera to control
 *                   (default: 192.168.1.50)
 *   SIGNALK_TOKEN   Optional bearer token, required when the server has
 *                   security enabled. Create one under
 *                   Security -> Devices/Users in the Signal K admin UI.
 *
 * Example:
 *   SIGNALK_URL=http://raspberrypi.local:3000 \
 *   CAMERA_ADDRESS=192.168.1.42 \
 *   SIGNALK_TOKEN=eyJhbGciOi... \
 *   node examples/ptz-control.js
 */

'use strict';

// ── Configuration ───────────────────────────────────────────────────────────

const SIGNALK_URL = (process.env.SIGNALK_URL || 'http://localhost:3000').replace(/\/+$/, '');
const CAMERA_ADDRESS = process.env.CAMERA_ADDRESS || '192.168.1.50';
const SIGNALK_TOKEN = process.env.SIGNALK_TOKEN || '';

// Root of the plugin's PTZ PUT paths, expressed in REST (slash) form.
const PTZ_BASE = '/signalk/v1/api/vessels/self/sensors/camera/ptz';

// Abort any single network request (connect + read) that takes longer than
// this, so a hung connection can never block later commands.
const REQUEST_TIMEOUT_MS = 5000;

// How long to keep polling an asynchronous (PENDING) request before giving up.
const REQUEST_POLL_TIMEOUT_MS = 10000;
const REQUEST_POLL_INTERVAL_MS = 250;

// ── Low-level helpers ────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Build request headers, adding the Authorization header only when a token is
// configured (open/dev servers don't need one).
function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (SIGNALK_TOKEN) {
    headers.Authorization = 'Bearer ' + SIGNALK_TOKEN;
  }
  return headers;
}

// Turn a thrown fetch/abort error into a readable message.
function describeError(error) {
  if (error && error.name === 'TimeoutError') {
    return 'Request timed out after ' + REQUEST_TIMEOUT_MS + ' ms';
  }
  return error && error.message ? error.message : String(error);
}

// Parse a fetch Response as JSON, tolerating empty bodies.
async function parseJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

// Perform a request bounded by an abortable per-request timeout that covers
// both the connection and the body read (AbortSignal.timeout aborts the whole
// fetch, including response.text()). Returns { status, body }; the caller
// translates a thrown error into a failed result.
async function fetchJson(url, options) {
  const response = await fetch(url, Object.assign({}, options, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }));
  const body = await parseJson(response);
  return { status: response.status, body: body };
}

// Coerce a { status, body } pair into a Signal K action result, guaranteeing a
// numeric statusCode is always present by falling back to the HTTP status when
// the body is empty or carries no statusCode.
function normaliseResult(fetched) {
  const body = fetched.body && typeof fetched.body === 'object' ? fetched.body : {};
  const result = Object.assign({}, body);
  if (typeof result.statusCode !== 'number') {
    result.statusCode = fetched.status;
  }
  return result;
}

// Signal K answers a PUT that resolves asynchronously with HTTP 202 and a body
// like { state: 'PENDING', href: '/signalk/v1/requests/<id>' }. Poll that href
// until the request reaches a terminal state (COMPLETED or FAILED), an HTTP
// error occurs, or the overall poll deadline is reached.
async function pollRequest(href) {
  const deadline = Date.now() + REQUEST_POLL_TIMEOUT_MS;
  let latest = null;
  while (Date.now() < deadline) {
    let fetched;
    try {
      fetched = await fetchJson(SIGNALK_URL + href, { headers: buildHeaders() });
    } catch (error) {
      return { state: 'FAILED', statusCode: 0, message: describeError(error) };
    }

    latest = normaliseResult(fetched);

    // An HTTP error (401/404/500, ...) won't be fixed by polling — stop now.
    if (fetched.status < 200 || fetched.status >= 300) {
      return latest;
    }
    // Stop once the request reaches a terminal state.
    if (latest.state && latest.state !== 'PENDING') {
      return latest;
    }
    await sleep(REQUEST_POLL_INTERVAL_MS);
  }
  // Timed out: return whatever the last poll produced so the caller can report it.
  return latest || { state: 'PENDING', statusCode: 408, message: 'Timed out waiting for request to complete' };
}

// Core helper: PUT a value to one of the PTZ command sub-paths and return the
// final Signal K action result ({ state, statusCode, message }). Handles both
// the synchronous (COMPLETED) and asynchronous (PENDING + href) responses, and
// never throws — network/timeout failures come back as a FAILED result.
async function signalkPut(subPath, value) {
  const url = SIGNALK_URL + PTZ_BASE + '/' + subPath;
  let fetched;
  try {
    fetched = await fetchJson(url, {
      method: 'PUT',
      headers: buildHeaders(),
      body: JSON.stringify({ value: value })
    });
  } catch (error) {
    return { state: 'FAILED', statusCode: 0, message: describeError(error) };
  }

  let result = normaliseResult(fetched);

  if (result.state === 'PENDING' && result.href) {
    result = await pollRequest(result.href);
  }

  return result;
}

// ── PTZ command wrappers ─────────────────────────────────────────────────────
//
// Each wrapper mirrors one PTZ PUT path. `speed` axes and `timeout` are in the
// ranges the plugin validates: x/y/z in [-1.0, 1.0], timeout in [1, 300] s.

// Continuous move. Positive x pans right, positive y tilts up, positive z zooms
// in. The camera keeps moving until `timeout` seconds elapse or you call stop().
function ptzMove(address, speed, timeout) {
  const command = { address: address, speed: speed };
  if (typeof timeout === 'number') {
    command.timeout = timeout;
  }
  return signalkPut('move', command);
}

// Stop any in-progress pan/tilt/zoom immediately.
function ptzStop(address) {
  // The stop and home paths also accept a bare address string, e.g.
  //   return signalkPut('stop', address);
  // but an object is used here for consistency with move().
  return signalkPut('stop', { address: address });
}

// Return the camera to its configured home position. `speed` is optional
// (0.0–1.0); the plugin defaults it to 1 when omitted.
function ptzHome(address, speed) {
  const command = { address: address };
  if (typeof speed === 'number') {
    command.speed = speed;
  }
  return signalkPut('home', command);
}

// ── Demonstration sequence ───────────────────────────────────────────────────

// Log a command and its result in a readable way, flagging non-2xx outcomes.
async function run(label, promise) {
  const result = await promise;
  const status = result && typeof result.statusCode === 'number' ? result.statusCode : '???';
  const ok = typeof status === 'number' && status >= 200 && status < 300;
  const detail = result && result.message ? ' - ' + result.message : '';
  console.log((ok ? '  ok   ' : '  FAIL ') + '[' + status + '] ' + label + detail);
  return result;
}

async function main() {
  console.log('Signal K server : ' + SIGNALK_URL);
  console.log('Camera address  : ' + CAMERA_ADDRESS);
  console.log('Auth token      : ' + (SIGNALK_TOKEN ? '(set)' : '(none)'));
  console.log('');
  console.log('Running PTZ demo sequence...');

  // 1. Pan right at half speed for up to 2 seconds.
  await run('pan right', ptzMove(CAMERA_ADDRESS, { x: 0.5, y: 0, z: 0 }, 2));
  await sleep(1500);

  // 2. Stop explicitly (in case the timeout hasn't elapsed yet).
  await run('stop', ptzStop(CAMERA_ADDRESS));
  await sleep(500);

  // 3. Tilt up at a gentle speed for up to 2 seconds, then stop.
  await run('tilt up', ptzMove(CAMERA_ADDRESS, { x: 0, y: 0.3, z: 0 }, 2));
  await sleep(1500);
  await run('stop', ptzStop(CAMERA_ADDRESS));
  await sleep(500);

  // 4. Zoom in briefly, then stop.
  await run('zoom in', ptzMove(CAMERA_ADDRESS, { x: 0, y: 0, z: 0.5 }, 2));
  await sleep(1000);
  await run('stop', ptzStop(CAMERA_ADDRESS));
  await sleep(500);

  // 5. Send the camera back to its home position.
  await run('go home', ptzHome(CAMERA_ADDRESS));

  console.log('');
  console.log('Done.');
}

// Only run the demo when executed directly (`node examples/ptz-control.js`), so
// the helpers above can also be `require()`d from your own scripts:
//   const { ptzMove, ptzStop, ptzHome } = require('./examples/ptz-control');
if (require.main === module) {
  main().catch(function (error) {
    console.error('PTZ demo failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { signalkPut, ptzMove, ptzStop, ptzHome };
