import { describe, expect, it } from 'vitest';
import { clampZoom, cropRect } from '@/lib/avatar-crop';

describe('avatar framing', () => {
  it('without zoom or moves takes the centred square of the picture', () => {
    expect(cropRect(400, 200, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 100, sy: 0, size: 200 });
  });

  it('zoom shrinks the square around the centre', () => {
    expect(cropRect(200, 200, { zoom: 2, x: 0, y: 0 })).toEqual({ sx: 50, sy: 50, size: 100 });
  });

  it('the picture moves freely in every direction, even past its edges', () => {
    expect(cropRect(400, 200, { zoom: 1, x: 0.25, y: 0 })).toEqual({ sx: 50, sy: 0, size: 200 });
    expect(cropRect(200, 200, { zoom: 1, x: -1, y: 0.5 })).toEqual({ sx: 200, sy: -100, size: 200 });
  });

  it('zoom stays between 1 and 3', () => {
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(0.2)).toBe(1);
  });
});
