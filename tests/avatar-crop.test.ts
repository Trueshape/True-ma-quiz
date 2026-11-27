import { describe, expect, it } from 'vitest';
import { clampFraming, cropRect } from '@/lib/avatar-crop';

describe('avatar framing', () => {
  it('without zoom or moves takes the centred square of the picture', () => {
    expect(cropRect(400, 200, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 100, sy: 0, size: 200 });
  });

  it('zoom shrinks the square around the centre', () => {
    expect(cropRect(200, 200, { zoom: 2, x: 0, y: 0 })).toEqual({ sx: 50, sy: 50, size: 100 });
  });

  it('moving the picture right shows more of its left side', () => {
    const r = cropRect(400, 200, { zoom: 1, x: 0.25, y: 0 });
    expect(r).toEqual({ sx: 50, sy: 0, size: 200 });
  });

  it('never lets the picture leave the circle empty', () => {
    expect(clampFraming(400, 200, { zoom: 1, x: 5, y: 5 })).toEqual({ zoom: 1, x: 0.5, y: 0 });
    expect(clampFraming(200, 200, { zoom: 2, x: -5, y: 0 })).toEqual({ zoom: 2, x: -0.5, y: 0 });
    expect(clampFraming(200, 200, { zoom: 9, x: 0, y: 0 }).zoom).toBe(3);
    expect(clampFraming(200, 200, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
  });
});
