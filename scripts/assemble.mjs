#!/usr/bin/env node
// Concatenate rendered segments (seg_XXXXXX.mp4) and mux the soundtrack.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const dir = arg('segs', 'out'), audio = arg('audio', 'audio.wav'), out = arg('out', 'meteor_shower_15min.mp4');
const files = fs.readdirSync(dir).filter((f) => /^seg_\d+\.mp4$/.test(f)).sort();
if (!files.length) { console.error('no segments in', dir); process.exit(1); }
const list = path.join(dir, 'concat.txt');
fs.writeFileSync(list, files.map((f) => `file '${path.resolve(dir, f)}'`).join('\n'));
const cmd = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (fs.existsSync(audio)) cmd.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
cmd.push('-c:v', 'copy', '-movflags', '+faststart', out);
const r = spawnSync('ffmpeg', cmd, { stdio: 'inherit' });
if (r.status) process.exit(r.status);
const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=nb_frames', '-of', 'default=nw=1', out], { encoding: 'utf8' });
console.log(`${files.length} segments -> ${out}\n${p.stdout}`);
