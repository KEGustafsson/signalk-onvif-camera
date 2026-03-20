export interface PtzPadRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PtzPadVector {
  x: number;
  y: number;
}

export function normalizePtzPadVector(
  clientX: number,
  clientY: number,
  rect: PtzPadRect
): PtzPadVector {
  const radius = Math.max(rect.width, rect.height) / 2;
  if (radius <= 0) {
    return { x: 0, y: 0 };
  }

  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const x = mx - radius;
  const y = radius - my;
  const distance = Math.min(Math.sqrt((x ** 2) + (y ** 2)) / radius, 1);
  const radians = Math.atan2(y, x);

  return {
    x: distance * Math.cos(radians),
    y: distance * Math.sin(radians)
  };
}
