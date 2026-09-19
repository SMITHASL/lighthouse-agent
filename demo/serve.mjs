import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

// Serves the captioned demo on :8797 (so live TrueForge pages can be framed from an http origin)
// and accepts the recorder's finished WebM at POST /upload.
const OUT = new URL('./lighthouse-demo.webm', import.meta.url);
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/upload') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await writeFile(OUT, Buffer.concat(chunks));
    res.writeHead(200).end('ok');
    console.log(`wrote ${OUT.pathname} (${Buffer.concat(chunks).length} bytes)`);
    return;
  }
  if (req.url === '/lighthouse-demo.webm') { const b = await readFile(OUT); res.writeHead(200, { 'content-type': 'video/webm', 'content-length': b.length }); return res.end(b); }
  const file = req.url?.startsWith('/record') ? './record.html' : './index.html';
  const html = await readFile(new URL(file, import.meta.url));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(8797, '127.0.0.1', () => console.log('captioned demo at http://localhost:8797  (Space to play, ←/→ to step); recorder at /record'));
