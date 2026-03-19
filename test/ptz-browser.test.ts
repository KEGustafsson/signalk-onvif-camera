import { normalizePtzPadVector } from '../src/ptz';

describe('browser ptz helpers', () => {
  test('clamps corner presses to a unit vector', () => {
    const vector = normalizePtzPadVector(0, 0, {
      left: 0,
      top: 0,
      width: 200,
      height: 200
    });

    expect(vector.x).toBeGreaterThanOrEqual(-1);
    expect(vector.x).toBeLessThanOrEqual(1);
    expect(vector.y).toBeGreaterThanOrEqual(-1);
    expect(vector.y).toBeLessThanOrEqual(1);
    expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1, 6);
  });

  test('returns zero vector when the pad radius is zero', () => {
    expect(normalizePtzPadVector(10, 10, {
      left: 0,
      top: 0,
      width: 0,
      height: 0
    })).toEqual({
      x: 0,
      y: 0
    });
  });
});
