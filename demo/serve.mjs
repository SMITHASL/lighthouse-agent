import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
// Serves the captioned demo on :8797 so the live TrueForge pages can be framed from an http origin.
createServer(async (_req, res) => {
  const html = await readFile(new URL('./index.html', import.meta.url));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(8797, '127.0.0.1', () => console.log('captioned demo at http://localhost:8797  (Space to play, ←/→ to step)'));
