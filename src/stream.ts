import type { SnapshotStreamMode } from './snapshot';

export interface StreamUrls {
  rtsp?: string;
  http?: string;
}

export interface StreamModalValues {
  rtsp: string;
  http: string;
  mjpeg: string;
  snapshot: string;
}

export interface StreamModeControlState {
  snapshotChecked: boolean;
  mjpegChecked: boolean;
}

const NOT_AVAILABLE = 'Not available';

function normalizeStreamValue(value: string | null | undefined): string {
  return value || NOT_AVAILABLE;
}

export function getStreamModalValues(
  streams: StreamUrls | null,
  mjpegUrl: string | null,
  snapshotUrl: string | null
): StreamModalValues {
  return {
    rtsp: normalizeStreamValue(streams?.rtsp),
    http: normalizeStreamValue(streams?.http),
    mjpeg: normalizeStreamValue(mjpegUrl),
    snapshot: normalizeStreamValue(snapshotUrl)
  };
}

export function shouldStartMjpegStream(streamMode: SnapshotStreamMode, mjpegUrl: string | null): boolean {
  return streamMode === 'mjpeg' && typeof mjpegUrl === 'string' && mjpegUrl.length > 0;
}

export function getStreamModeControlState(streamMode: SnapshotStreamMode): StreamModeControlState {
  return {
    snapshotChecked: streamMode === 'snapshot',
    mjpegChecked: streamMode === 'mjpeg'
  };
}
