import { readFileSync, writeFileSync } from 'node:fs';
// MediaRecorder writes fragmented MP4 whose moov declares only the first fragment's length.
// Patch mvhd / tkhd / mdhd / mehd durations to the real length so every player shows and seeks the whole video.
const [file, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg);
if (!file || !seconds) { console.error('usage: node fix-mp4-duration.mjs <file.mp4> <seconds>'); process.exit(2); }
const buf = readFileSync(file);
const patched = [];
function walk(start, end, depth = 0) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
    if (size === 0) size = end - p;
    const body = p + header;
    if (['moov', 'trak', 'mdia', 'mvex'].includes(type)) walk(body, p + size, depth + 1);
    else if (type === 'mvhd' || type === 'mdhd') {
      const v = buf[body];
      const tsOff = v === 1 ? body + 4 + 16 : body + 4 + 8;
      const timescale = buf.readUInt32BE(tsOff);
      const dur = Math.round(seconds * timescale);
      if (v === 1) buf.writeBigUInt64BE(BigInt(dur), tsOff + 4); else buf.writeUInt32BE(dur, tsOff + 4);
      patched.push(`${type}(v${v}) ts=${timescale} dur=${dur}`);
      if (type === 'mvhd') globalThis.movieTs = timescale;
    } else if (type === 'tkhd') {
      const v = buf[body];
      const durOff = v === 1 ? body + 4 + 8 + 8 + 4 + 4 : body + 4 + 4 + 4 + 4 + 4;
      const dur = Math.round(seconds * (globalThis.movieTs ?? 1000));
      if (v === 1) buf.writeBigUInt64BE(BigInt(dur), durOff); else buf.writeUInt32BE(dur, durOff);
      patched.push(`tkhd(v${v}) dur=${dur}`);
    } else if (type === 'mehd') {
      const v = buf[body];
      const dur = Math.round(seconds * (globalThis.movieTs ?? 1000));
      if (v === 1) buf.writeBigUInt64BE(BigInt(dur), body + 4); else buf.writeUInt32BE(dur, body + 4);
      patched.push(`mehd(v${v}) dur=${dur}`);
    }
    p += size;
  }
}
walk(0, buf.length);
writeFileSync(file, buf);
console.log(patched.join('\n') || 'no duration boxes found');
