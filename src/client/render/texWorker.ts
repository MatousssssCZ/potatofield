import { generateTexture } from './texgen';

self.onmessage = (e: MessageEvent<{ id: string; size: number; job: number }>) => {
  const { id, size, job } = e.data;
  const t = generateTexture(id, size);
  (self as unknown as Worker).postMessage({ job, id, tex: t }, [t.albedo.buffer, t.normal.buffer, t.orm.buffer]);
};
