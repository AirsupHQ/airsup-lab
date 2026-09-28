/**
 * Render any tour to a 1080p video, frame by frame, so it never drops a frame.
 *
 *   npm run dev            (in another terminal)
 *   npm run record -- jet films/jet.mp4 60
 *
 * Tours: fusion, main, pump, line, car, motor, robot, hole, jet, f1, drone, grand, hall.
 * Needs Playwright (npm i -D playwright && npx playwright install chromium) and ffmpeg.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [tour = 'grand', out = `films/${tour}.mp4`, fps = '60', url = 'http://127.0.0.1:5173/'] = process.argv.slice(2)
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(`${url}?rec=1&rs=1&ex=${tour === 'main' ? 'engine' : tour}`)
await page.waitForFunction(() => window.__rec, null, { timeout: 180000 })
const duration = await page.evaluate((t) => window.__rec.start(t), tour)
const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'inherit'] })
const n = Math.ceil(duration * Number(fps))
for (let i = 0; i < n; i++) {
  const r = await page.evaluate((dt) => window.__rec.frame(dt), 1 / Number(fps))
  const shot = await page.screenshot({ type: 'jpeg', quality: 95 })
  if (!ff.stdin.write(shot)) await new Promise((res) => ff.stdin.once('drain', res))
  if (i % 300 === 0) console.log(`frame ${i} / ${n}`)
  if (!r.active && i > 10) break
}
ff.stdin.end()
await new Promise((res) => ff.on('close', res))
await browser.close()
console.log('wrote', out)
