/**
 * capture-mobile-thumbs.mjs
 *
 * Screenshots each demo site's pages at mobile viewport (375x812)
 * and saves as WebP thumbnails for the mobile portfolio view.
 *
 * Output: public/thumbnails/mobile/{id}.webp, {id}-2.webp, {id}-3.webp
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

const PROJECTS = [
  { id: 'hartley', url: 'https://demo-hartley-plumbing.vercel.app', pages: ['/#services', '/', '/#contact'], fileBase: 'hartley' },
  { id: 'kin', url: 'https://demo-kin-grain-cafe.vercel.app', pages: ['/#menu', '/', '/#contact'], fileBase: 'cafe' },
  { id: 'apex', url: 'https://demo-apex-fitness.vercel.app', pages: ['/#classes', '/', '/#contact'], fileBase: 'fitness' },
  { id: 'whitfield', url: 'https://demo-whitfield-accounting.vercel.app', pages: ['/#insights', '/', '/#contact'], fileBase: 'accounting' },
  { id: 'luma', url: 'https://demo-luma-beauty.vercel.app', pages: ['/shop', '/', '/about'], fileBase: 'beauty' },
  { id: 'flowline', url: 'https://demo-flowline-saas.vercel.app', pages: ['/#features', '/', '/#pricing'], fileBase: 'saas' },
  { id: 'evergreen', url: 'https://demo-evergreen-events.vercel.app', pages: ['/portfolio', '/', '/services'], fileBase: 'events' },
];

const WIDTH = 375;
const HEIGHT = 812;
const OUT_WIDTH = 375; // Output at 1x — srcset handles density

const outDir = resolve('public/thumbnails/mobile');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

async function captureProject(project) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  // Map pages to file suffixes: pages[0] → -2, pages[1] (/) → base, pages[2] → -3
  const pageMap = [
    { path: project.pages[0], suffix: '-2' },
    { path: project.pages[1], suffix: '' },
    { path: project.pages[2], suffix: '-3' },
  ];

  for (const { path: pagePath, suffix } of pageMap) {
    const url = pagePath.startsWith('/') && !pagePath.startsWith('/#')
      ? project.url + pagePath
      : project.url + pagePath;

    console.log(`  ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500); // Let animations settle

    // For hash links, scroll to the section
    if (pagePath.startsWith('/#')) {
      const hash = pagePath.replace('/', '');
      await page.evaluate((h) => {
        const el = document.querySelector(h);
        if (el) el.scrollIntoView({ behavior: 'instant' });
      }, hash);
      await page.waitForTimeout(500);
    }

    const screenshotBuf = await page.screenshot({ type: 'png' });
    const outPath = resolve(outDir, `${project.fileBase}${suffix}.webp`);

    await sharp(screenshotBuf)
      .resize(OUT_WIDTH, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outPath);
  }

  await browser.close();
}

async function main() {
  console.log(`Capturing mobile thumbnails (${WIDTH}x${HEIGHT})...\n`);

  for (const project of PROJECTS) {
    console.log(`[${project.id}]`);
    try {
      await captureProject(project);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
    console.log('');
  }

  console.log('Done.');
}

main();
