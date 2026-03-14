/**
 * extract-palette.mjs
 * Extracts dominant colours from project thumbnails and generates
 * harmonious complementary palettes (background + accent pairs).
 *
 * Strategy:
 * 1. Filter to chromatic pixels, find hue peaks
 * 2. When multiple projects share similar hues, use secondary peaks
 * 3. Different accent rotation per project for variety
 * 4. Verify WCAG contrast ratios
 */

import { createRequire } from 'module';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const require = createRequire(join(ROOT, 'node_modules', 'astro', 'package.json'));
const sharp = require('sharp');

const PROJECTS = [
  { id: 'hartley', file: 'hartley.webp' },
  { id: 'kin',     file: 'cafe.webp' },
  { id: 'apex',    file: 'fitness.webp' },
  { id: 'whitfield', file: 'accounting.webp' },
  { id: 'luma',    file: 'hair.webp' },
];

// Varied accent rotations for visual diversity
const ACCENT_ROTATIONS = [150, 170, 140, 160, 190];

// ─── Colour helpers ───

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hueDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ─── Hue extraction ───

function findHuePeaks(pixels) {
  const chromatic = [];
  for (const [r, g, b] of pixels) {
    const hsl = rgbToHsl(r, g, b);
    // Strict filter: real colours only (S>20%, L 15-85%)
    if (hsl.s > 20 && hsl.l > 15 && hsl.l < 85) {
      chromatic.push(hsl);
    }
  }

  if (chromatic.length < 10) return [];

  // Hue histogram — 36 bins of 10°
  const bins = new Array(36).fill(0);
  const satSum = new Array(36).fill(0);

  for (const { h, s } of chromatic) {
    const bin = Math.floor(h / 10) % 36;
    bins[bin]++;
    satSum[bin] += s;
  }

  const peaks = [];
  for (let i = 0; i < 36; i++) {
    if (bins[i] < 3) continue; // minimum pixel threshold
    const avgSat = satSum[i] / bins[i];
    peaks.push({ hue: i * 10 + 5, count: bins[i], avgSat, score: bins[i] * avgSat });
  }
  peaks.sort((a, b) => b.score - a.score);

  return peaks;
}

// ─── Palette generation ───

function makePalette(hue, sat, rotation) {
  const bgHsl = {
    h: hue,
    s: Math.max(Math.min(sat * 0.6, 45), 22),
    l: 25,
  };
  const accentHsl = {
    h: (hue + rotation) % 360,
    s: Math.max(Math.min(bgHsl.s + 10, 48), 25),
    l: 78,
  };
  return { bgHsl, accentHsl };
}

function ensureContrast(bgHsl, accentHsl) {
  const textRgb = [240, 240, 240];

  let bgRgb = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);
  let textCR = contrastRatio(bgRgb.r, bgRgb.g, bgRgb.b, ...textRgb);
  while (textCR < 4.5 && bgHsl.l > 8) {
    bgHsl.l -= 1;
    bgRgb = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);
    textCR = contrastRatio(bgRgb.r, bgRgb.g, bgRgb.b, ...textRgb);
  }

  let accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
  let accentCR = contrastRatio(bgRgb.r, bgRgb.g, bgRgb.b, accentRgb.r, accentRgb.g, accentRgb.b);
  while (accentCR < 3 && accentHsl.l < 95) {
    accentHsl.l += 1;
    accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
    accentCR = contrastRatio(bgRgb.r, bgRgb.g, bgRgb.b, accentRgb.r, accentRgb.g, accentRgb.b);
  }

  return {
    bgHsl, accentHsl,
    bgRgb: [bgRgb.r, bgRgb.g, bgRgb.b],
    accentRgb: [accentRgb.r, accentRgb.g, accentRgb.b],
    textCR: textCR.toFixed(2),
    accentCR: accentCR.toFixed(2),
  };
}

// ─── Main ───

async function main() {
  console.log('\n  Palette Extraction\n  ══════════════════\n');

  // Phase 1: extract all hue peaks
  const projectPeaks = [];

  for (const project of PROJECTS) {
    const imagePath = join(ROOT, 'public', 'thumbnails', project.file);
    if (!existsSync(imagePath)) {
      projectPeaks.push({ id: project.id, peaks: [] });
      continue;
    }
    const { data } = await sharp(imagePath)
      .resize(100, 100, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [];
    for (let i = 0; i < data.length; i += 3) {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    projectPeaks.push({ id: project.id, peaks: findHuePeaks(pixels) });
  }

  // Phase 2: assign hues — use secondary peaks when primaries collide
  const MIN_SEP = 35;
  const assignedHues = [];
  const assignedSats = [];
  const peakUsed = []; // which peak index was used

  for (let i = 0; i < projectPeaks.length; i++) {
    const { peaks } = projectPeaks[i];
    if (peaks.length === 0) {
      assignedHues.push(i * 72);
      assignedSats.push(40);
      peakUsed.push(-1);
      continue;
    }

    // Try each peak until we find one that's far enough from already-assigned hues
    let chosen = null;
    for (const peak of peaks) {
      const tooClose = assignedHues.some(h => hueDist(peak.hue, h) < MIN_SEP);
      if (!tooClose) {
        chosen = peak;
        break;
      }
    }

    // If all peaks collide, still use the top peak
    if (!chosen) chosen = peaks[0];

    assignedHues.push(chosen.hue);
    assignedSats.push(chosen.avgSat);
    peakUsed.push(peaks.indexOf(chosen));
  }

  // Phase 3: generate palettes
  const palettes = {};

  for (let i = 0; i < PROJECTS.length; i++) {
    const project = PROJECTS[i];
    const rotation = ACCENT_ROTATIONS[i];
    const hue = assignedHues[i];
    const sat = assignedSats[i];
    const peaks = projectPeaks[i].peaks;

    const { bgHsl, accentHsl } = makePalette(hue, sat, rotation);
    const result = ensureContrast(bgHsl, accentHsl);
    const bgHex = rgbToHex(...result.bgRgb);
    const accentHex = rgbToHex(...result.accentRgb);

    palettes[project.id] = {
      background: bgHex,
      accent: accentHex,
      text: '#f0f0f0',
      textMode: 'light',
    };

    const peakInfo = peaks.length > 0
      ? peaks.slice(0, 3).map((p, j) => `${p.hue}°${j === peakUsed[i] ? '*' : ''}`).join(', ')
      : 'fallback';

    console.log(`  ${project.id.toUpperCase()}`);
    console.log(`    Peaks:       ${peakInfo}  (used: ${hue}° + ${rotation}° rotation)`);
    console.log(`    Background:  ${bgHex}  (H:${result.bgHsl.h.toFixed(0)} S:${result.bgHsl.s.toFixed(0)} L:${result.bgHsl.l.toFixed(0)})`);
    console.log(`    Accent:      ${accentHex}  (H:${result.accentHsl.h.toFixed(0)} S:${result.accentHsl.s.toFixed(0)} L:${result.accentHsl.l.toFixed(0)})`);
    console.log(`    Contrast:    accent ${result.accentCR}:1  text ${result.textCR}:1`);
    console.log('');
  }

  const outPath = join(ROOT, 'src', 'data', 'palettes.json');
  writeFileSync(outPath, JSON.stringify(palettes, null, 2));
  console.log(`  ✓ Saved to src/data/palettes.json\n`);
}

main().catch(err => {
  console.error('Palette extraction failed:', err);
  process.exit(1);
});
