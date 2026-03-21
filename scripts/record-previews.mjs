/**
 * record-previews.mjs
 *
 * Records a smooth scroll-through of each demo site as an MP4 video.
 * Output: public/previews/{projectId}.mp4
 *
 * Usage: node scripts/record-previews.mjs [--project=hartley]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';

const PROJECTS = [
  { id: 'hartley', url: 'https://demo-hartley-plumbing.vercel.app' },
  { id: 'kin', url: 'https://demo-kin-grain-cafe.vercel.app' },
  { id: 'apex', url: 'https://demo-apex-fitness.vercel.app' },
  { id: 'whitfield', url: 'https://demo-whitfield-accounting.vercel.app' },
  { id: 'luma', url: 'https://demo-luma-beauty.vercel.app' },
  { id: 'flowline', url: 'https://demo-flowline-saas.vercel.app' },
  { id: 'evergreen', url: 'https://demo-evergreen-events.vercel.app' },
];

// Video dimensions — full desktop viewport for crisp preview
const WIDTH = 1440;
const HEIGHT = 900;

// Scroll config
const SCROLL_DURATION_MS = 14000; // 14 seconds of smooth scrolling
const SETTLE_MS = 2000; // pause at top before scrolling
const END_PAUSE_MS = 1500; // pause at bottom before stopping

const outDir = resolve('public/previews');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Allow filtering to a single project via --project=id
const projectArg = process.argv.find(a => a.startsWith('--project='));
const filterProject = projectArg ? projectArg.split('=')[1] : null;
const projects = filterProject
  ? PROJECTS.filter(p => p.id === filterProject)
  : PROJECTS;

if (projects.length === 0) {
  console.error(`Unknown project: ${filterProject}`);
  process.exit(1);
}

const FPS = 30;
const FRAME_INTERVAL = 1000 / FPS;

async function recordProject(project) {
  const browser = await chromium.launch({
    // Force proper frame pacing for smooth video capture
    args: [
      '--run-all-compositor-stages-before-draw',
      '--disable-checker-imaging',
      '--disable-image-animation-resync',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: outDir, size: { width: WIDTH, height: HEIGHT } },
    reducedMotion: 'no-preference',
  });

  const page = await context.newPage();

  console.log(`  Loading ${project.url}...`);
  await page.goto(project.url, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for page to fully render + animations to settle
  await page.waitForTimeout(SETTLE_MS);

  // Smooth scroll using time-locked steps synced to our target FPS.
  // Each step: set exact scroll position for this frame, then wait exactly
  // one frame interval. This produces perfectly even motion in the recording.
  const scrollHeight = await page.evaluate(() =>
    document.documentElement.scrollHeight - window.innerHeight
  );

  if (scrollHeight > 0) {
    const totalFrames = Math.round(SCROLL_DURATION_MS / FRAME_INTERVAL);
    console.log(`  Scrolling ${scrollHeight}px — ${totalFrames} frames at ${FPS}fps...`);

    // Disable smooth-scroll CSS so scrollTo is instant
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
    });

    // Ease-in-out cubic
    function ease(t) {
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    for (let f = 0; f <= totalFrames; f++) {
      const progress = f / totalFrames;
      const y = Math.round(scrollHeight * ease(progress));
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      // Wait exactly one frame — gives the recorder a clean frame to capture
      await page.waitForTimeout(FRAME_INTERVAL);
    }
  }

  // Pause at bottom
  await page.waitForTimeout(END_PAUSE_MS);

  // Close context to finalize the video
  await context.close();
  await browser.close();

  // Playwright saves to a random filename — copy to final name then clean up
  const videoPath = await page.video().path();
  const finalPath = join(outDir, `${project.id}.webm`);
  try { unlinkSync(finalPath); } catch {}
  copyFileSync(videoPath, finalPath);
  try { unlinkSync(videoPath); } catch {}

  console.log(`  ✓ Saved: ${finalPath}`);
  return finalPath;
}

async function main() {
  console.log(`Recording ${projects.length} preview video(s)...\n`);

  for (const project of projects) {
    console.log(`[${project.id}]`);
    try {
      await recordProject(project);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
    console.log('');
  }

  console.log('Done. Run `ffmpeg` conversion if MP4 needed (Playwright outputs WebM).');
  console.log('Or use <video> with WebM directly — browser support is excellent.');
}

main();
