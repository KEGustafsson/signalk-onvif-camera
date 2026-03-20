import { getStreamModalValues, getStreamModeControlState, shouldStartMjpegStream } from '../src/stream';

describe('browser stream helpers', () => {
  test('restores mjpeg mode after reconnect when a mjpeg URL is available', () => {
    expect(shouldStartMjpegStream('mjpeg', 'http://camera/mjpeg')).toBe(true);
    expect(shouldStartMjpegStream('snapshot', 'http://camera/mjpeg')).toBe(false);
    expect(shouldStartMjpegStream('mjpeg', null)).toBe(false);
  });

  test('fills stream modal values with explicit fallbacks', () => {
    expect(getStreamModalValues(null, null, null)).toEqual({
      rtsp: 'Not available',
      http: 'Not available',
      mjpeg: 'Not available',
      snapshot: 'Not available'
    });

    expect(getStreamModalValues(
      {
        rtsp: 'rtsp://camera/stream',
        http: ''
      },
      'http://camera/mjpeg',
      'http://camera/snapshot'
    )).toEqual({
      rtsp: 'rtsp://camera/stream',
      http: 'Not available',
      mjpeg: 'http://camera/mjpeg',
      snapshot: 'http://camera/snapshot'
    });
  });

  test('maps the active selector state from the actual stream mode', () => {
    expect(getStreamModeControlState('snapshot')).toEqual({
      snapshotChecked: true,
      mjpegChecked: false
    });
    expect(getStreamModeControlState('mjpeg')).toEqual({
      snapshotChecked: false,
      mjpegChecked: true
    });
  });
});
