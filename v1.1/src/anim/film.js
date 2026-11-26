// Hoodoo film encoder: frames rendered by the raytracer go through WebCodecs H.264 into an MP4 file.

const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';

export function filmSupported() {
  return typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';
}

export async function createFilm({ width, height, fps }) {
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
  const w = width - (width % 2), h = height - (height % 2);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let failed = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
  const codecs = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42003e'];
  let config = null;
  for (const codec of codecs) {
    const c = { codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.22), framerate: fps, avc: { format: 'avc' } };
    try { const s = await VideoEncoder.isConfigSupported(c); if (s.supported) { config = c; break; } } catch (e) { /* try next */ }
  }
  if (!config) throw new Error('H.264 encoder unavailable');
  enc.configure(config);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  let n = 0;
  return {
    width: w, height: h,
    async add(imageData) {
      if (failed) throw failed;
      ctx.putImageData(imageData, 0, 0);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      n++;
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    },
    async finish() {
      await enc.flush();
      enc.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    cancel() { try { enc.close(); } catch (e) { /* closed */ } },
  };
}
