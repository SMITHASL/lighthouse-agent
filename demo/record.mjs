import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Records demo/index.html to demo/lighthouse-demo.webm using the installed Chrome:
// a throwaway profile, the recorder page captures its own tab (auto-selected by title),
// MediaRecorder encodes VP9, the demo server writes the upload. Needs `npm run demo` running.
const CHROME = process.env.CHROME ?? 'C:\Program Files\Google\Chrome\Application\chrome.exe';
const OUT = new URL('./lighthouse-demo.webm', import.meta.url);
const outPath = decodeURIComponent(OUT.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (existsSync(outPath)) rmSync(outPath);
const chrome = spawn(CHROME, [
  `--user-data-dir=${join(tmpdir(), 'lighthouse-chrome-profile')}`,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,800', '--window-position=40,40',
  '--auto-select-tab-capture-source-by-title=Lighthouse recorder',
  'http://localhost:8797/record',
], { stdio: 'ignore', detached: true });
console.log('recording… keep the Chrome window visible (~3.5 min)');
const started = Date.now();
const timer = setInterval(() => {
  if (existsSync(outPath) && statSync(outPath).size > 1_000_000) {
    clearInterval(timer);
    console.log(`wrote ${outPath} (${statSync(outPath).size} bytes). Duration header: fix in-browser with fix-webm-duration if a player shows ∞.`);
    try { process.kill(chrome.pid); } catch {}
    process.exit(0);
  }
  if (Date.now() - started > 8 * 60_000) { console.error('timed out'); process.exit(1); }
}, 3000);
