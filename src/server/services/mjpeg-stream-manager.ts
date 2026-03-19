'use strict';

function createMjpegStreamManager({ snapshotInterval }) {
  const streams = new Map();
  const maxStreams = 10;
  let streamCounter = 0;

  function isAtCapacity() {
    return streams.size >= maxStreams;
  }

  function abortAll() {
    streams.forEach((stream) => {
      if (stream.abort) {
        stream.abort();
      }
    });
    streams.clear();
  }

  function startStream({ address, device, req, res }) {
    const boundary = 'mjpegboundary';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    const frameTimeoutMs = 10000;
    const streamId = `${address}-${++streamCounter}`;
    let active = true;

    const sendFrame = () => {
      if (!active) return;
      let frameTimedOut = false;
      const frameTimer = setTimeout(() => {
        frameTimedOut = true;
        active = false;
        streams.delete(streamId);
        try { res.end(); } catch (_error) {}
      }, frameTimeoutMs);

      device.fetchSnapshot((error, result) => {
        clearTimeout(frameTimer);
        if (frameTimedOut || !active) return;
        if (!error && result && result.body && result.body.length > 0) {
          const frame = result.body;
          const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
          try {
            res.write(header);
            res.write(frame);
            res.write('\r\n');
          } catch (_error) {
            active = false;
            return;
          }
        }
        if (active) {
          setTimeout(sendFrame, snapshotInterval);
        }
      });
    };

    streams.set(streamId, { abort: () => { active = false; }, res });
    req.on('close', () => {
      active = false;
      streams.delete(streamId);
    });
    req.on('error', () => {
      active = false;
      streams.delete(streamId);
    });

    sendFrame();
  }

  return {
    abortAll,
    isAtCapacity,
    startStream
  };
}

module.exports = {
  createMjpegStreamManager
};
