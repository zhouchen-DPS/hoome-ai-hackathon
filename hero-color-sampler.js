// Color readback stays off the animation thread; each request transfers one local frame.
'use strict';
let surface, context;
self.onmessage = event => {
  const { id, bitmap } = event.data;
  try {
    const started = performance.now();
    if (!surface) {
      surface = new OffscreenCanvas(128, 128);
      context = surface.getContext('2d', { willReadFrequently: true });
    }
    if (!context) throw new Error('Offscreen sampling is unavailable');
    context.drawImage(bitmap, 0, 0, 128, 128); bitmap.close();
    const pixels = context.getImageData(0, 0, 128, 128).data;
    self.postMessage({ id, pixels, cpuMs: performance.now() - started }, [pixels.buffer]);
  } catch (error) {
    bitmap.close(); self.postMessage({ id, error: error.message });
  }
};
