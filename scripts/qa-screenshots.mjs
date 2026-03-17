import { chromium } from 'playwright';

const BASE = 'http://localhost:4380';
const OUT = 'C:/Users/Ster/Documents/Ster-Files/Web-Design/portfolio-site-alt/screenshots';
const SLIDES = 7; // 0-6

async function takeScreenshots(viewportName, width, height) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Wait for hero animation
  await page.waitForTimeout(2500);

  for (let i = 0; i < SLIDES; i++) {
    if (i > 0) {
      // Use ArrowDown key to advance one slide
      await page.keyboard.press('ArrowDown');
      // Wait for transition (1200ms lock) + content animations
      await page.waitForTimeout(2000);
    }
    const path = `${OUT}/qa-${viewportName}-slide-${i}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`Captured: ${path}`);
  }

  await browser.close();
}

(async () => {
  console.log('Taking desktop screenshots (1440x900)...');
  await takeScreenshots('desktop', 1440, 900);

  console.log('Taking mobile screenshots (375x812)...');
  await takeScreenshots('mobile', 375, 812);

  console.log('Done!');
})();
