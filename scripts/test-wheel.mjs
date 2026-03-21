import { chromium } from 'playwright';

const BASE = 'http://localhost:4321';

async function testWheel() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Inject slide change logger
  await page.evaluate(() => {
    window.__slideLog = [];
    const observer = new MutationObserver(() => {
      const active = document.querySelector('.slide.active');
      if (active) {
        const id = active.id;
        const last = window.__slideLog[window.__slideLog.length - 1];
        if (!last || last.id !== id) {
          window.__slideLog.push({ id, time: Date.now() });
        }
      }
    });
    document.querySelectorAll('.slide').forEach(s => {
      observer.observe(s, { attributes: true, attributeFilter: ['class'] });
    });
    window.__slideLog.push({ id: 'slide-0', time: Date.now(), label: 'init' });
  });

  function resetLog() {
    return page.evaluate(() => {
      window.__slideLog = [{ id: document.querySelector('.slide.active')?.id, time: Date.now() }];
    });
  }

  async function goTo(slideIndex) {
    await page.evaluate((idx) => {
      const btn = document.querySelector('#slide-nav [data-slide="' + idx + '"]');
      if (btn) btn.click();
    }, slideIndex);
    await page.waitForTimeout(1000);
  }

  // Use real Playwright wheel events — these trigger native scrolling
  async function realSwipe(direction = 'down', strength = 'normal') {
    const sign = direction === 'down' ? 1 : -1;
    const deltas = strength === 'gentle'
      ? [3, 8, 15, 20, 15, 10, 5, 3, 2, 1]
      : [2, 5, 12, 25, 40, 55, 60, 50, 35, 28, 22, 18, 14, 11, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1, 1];

    for (const d of deltas) {
      await page.mouse.wheel(0, d * sign);
      await page.waitForTimeout(8);
    }
  }

  console.log('\n=== TEST 1: Single swipe down — should produce exactly 1 ===');
  await realSwipe('down');
  await page.waitForTimeout(2000);
  let log = await page.evaluate(() => window.__slideLog);
  console.log('Slides:', log.map(l => l.id));
  console.log(`${log.length - 1 === 1 ? 'PASS' : 'FAIL'} (${log.length - 1} changes)`);

  console.log('\n=== TEST 2: Two swipes with pause — should produce 2 ===');
  await resetLog();
  await realSwipe('down');
  await page.waitForTimeout(800);
  await realSwipe('down');
  await page.waitForTimeout(2000);
  log = await page.evaluate(() => window.__slideLog);
  console.log('Slides:', log.map(l => l.id));
  console.log(`${log.length - 1 === 2 ? 'PASS' : 'NOTE'} (${log.length - 1} changes)`);

  console.log('\n=== TEST 3: Gentle swipe ===');
  await resetLog();
  await realSwipe('down', 'gentle');
  await page.waitForTimeout(1500);
  log = await page.evaluate(() => window.__slideLog);
  console.log('Slides:', log.map(l => l.id));
  console.log(`${log.length - 1 === 1 ? 'PASS' : 'NOTE'} (${log.length - 1} changes)`);

  console.log('\n=== TEST 4: Arrow key interrupts ===');
  await goTo(0);
  await resetLog();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);
  log = await page.evaluate(() => window.__slideLog);
  console.log('Slides:', log.map(l => l.id));
  const final = log[log.length - 1]?.id;
  console.log(`Final: ${final} — ${final === 'slide-4' ? 'PASS' : 'NOTE'}`);

  // Debug: check scroll driver state
  const driverInfo = await page.evaluate(() => {
    const d = document.getElementById('scroll-driver');
    return {
      scrollTop: d?.scrollTop,
      scrollHeight: d?.scrollHeight,
      clientHeight: d?.clientHeight,
      childCount: d?.children.length,
      overflow: getComputedStyle(d).overflowY,
    };
  });
  console.log('\nScroll driver state:', driverInfo);

  await browser.close();
}

testWheel().catch(console.error);
