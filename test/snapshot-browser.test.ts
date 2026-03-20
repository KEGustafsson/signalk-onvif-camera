import {
  createSnapshotRequestId,
  DEFAULT_SNAPSHOT_INTERVAL,
  getNextSnapshotDelay,
  getRemainingSnapshotDelay,
  getSnapshotRequestTimeout,
  isExpectedSnapshotResponse,
  normalizeSnapshotInterval
} from '../src/snapshot';

describe('browser snapshot helpers', () => {
  test('normalizes invalid snapshot intervals to the default value', () => {
    expect(normalizeSnapshotInterval(undefined)).toBe(DEFAULT_SNAPSHOT_INTERVAL);
    expect(normalizeSnapshotInterval('100')).toBe(DEFAULT_SNAPSHOT_INTERVAL);
    expect(normalizeSnapshotInterval(25)).toBe(DEFAULT_SNAPSHOT_INTERVAL);
  });

  test('keeps configured snapshot intervals that meet the minimum', () => {
    expect(normalizeSnapshotInterval(50)).toBe(50);
    expect(normalizeSnapshotInterval(175)).toBe(175);
  });

  test('only schedules snapshot polling while connected in snapshot mode', () => {
    expect(getNextSnapshotDelay(150, true, 'snapshot')).toBe(150);
    expect(getNextSnapshotDelay(150, false, 'snapshot')).toBeNull();
    expect(getNextSnapshotDelay(150, true, 'mjpeg')).toBeNull();
  });

  test('only waits for the remaining interval after a snapshot request finishes', () => {
    expect(getRemainingSnapshotDelay(100, 1000, 1030)).toBe(70);
    expect(getRemainingSnapshotDelay(100, 1000, 1100)).toBe(0);
    expect(getRemainingSnapshotDelay(100, 1000, 1400)).toBe(0);
  });

  test('uses a minimum timeout for hung snapshot requests', () => {
    expect(getSnapshotRequestTimeout(100)).toBe(10000);
    expect(getSnapshotRequestTimeout(1500)).toBe(15000);
  });

  test('creates unique request ids and only accepts the active response', () => {
    const firstRequestId = createSnapshotRequestId(0, '10.0.0.20');
    const secondRequestId = createSnapshotRequestId(1, '10.0.0.20');

    expect(firstRequestId).not.toBe(secondRequestId);
    expect(isExpectedSnapshotResponse(secondRequestId, firstRequestId)).toBe(false);
    expect(isExpectedSnapshotResponse(secondRequestId, secondRequestId)).toBe(true);
    expect(isExpectedSnapshotResponse(null, secondRequestId)).toBe(false);
  });
});
