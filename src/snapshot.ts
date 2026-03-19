export type SnapshotStreamMode = 'snapshot' | 'mjpeg';

export const DEFAULT_SNAPSHOT_INTERVAL = 100;
export const MIN_SNAPSHOT_INTERVAL = 50;

export function normalizeSnapshotInterval(value: unknown, fallback = DEFAULT_SNAPSHOT_INTERVAL): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_SNAPSHOT_INTERVAL
    ? value
    : fallback;
}

export function getNextSnapshotDelay(
  snapshotInterval: number,
  deviceConnected: boolean,
  streamMode: SnapshotStreamMode
): number | null {
  return deviceConnected && streamMode === 'snapshot'
    ? snapshotInterval
    : null;
}

export function getRemainingSnapshotDelay(
  snapshotInterval: number,
  requestStartedAt: number,
  now = Date.now()
): number {
  const elapsed = Math.max(0, now - requestStartedAt);
  return Math.max(0, snapshotInterval - elapsed);
}

export function createSnapshotRequestId(sequence: number, address: string): string {
  return `${sequence}:${address}`;
}

export function isExpectedSnapshotResponse(expectedRequestId: string | null, responseRequestId: unknown): boolean {
  return typeof responseRequestId === 'string'
    && responseRequestId.length > 0
    && responseRequestId === expectedRequestId;
}
