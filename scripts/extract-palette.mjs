/**
 * extract-palette.mjs
 * Vibrant complementary palette generation.
 *
 * Principle: TWO chromatic voices per slide — both VIVID.
 * Near-complement hue rotation (140-170°). High saturation.
 * Accent lighter but never pastel. Global hue diversity enforced.
 *
 * The "Flowline standard": bg ≈ S:65%+ L:35-45%, accent ≈ S:55%+ L:70-80%.
 * Both colors must pop. No muddy browns, no washed-out pastels.
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
  { id: 'luma',    file: 'beauty.webp' },
  { id: 'flowline', file: 'saas.webp' },
  { id: 'evergreen', file: 'events.webp' },
];

// ─── Colour math ───

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
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(...rgb1), l2 = relativeLuminance(...rgb2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ─── STEP 1: Extract dominant colours (median-cut, 10 clusters at 80x80) ───

function medianCut(pixels, n) {
  const widest = (bucket) => {
    let r0=255,r1=0,g0=255,g1=0,b0=255,b1=0;
    for (const [r,g,b] of bucket) {
      if(r<r0)r0=r;if(r>r1)r1=r;if(g<g0)g0=g;if(g>g1)g1=g;if(b<b0)b0=b;if(b>b1)b1=b;
    }
    const d=[r1-r0,g1-g0,b1-b0]; return d.indexOf(Math.max(...d));
  };
  const avg = (bucket) => {
    let rs=0,gs=0,bs=0;
    for (const [r,g,b] of bucket) { rs+=r; gs+=g; bs+=b; }
    const n=bucket.length;
    return [Math.round(rs/n),Math.round(gs/n),Math.round(bs/n)];
  };
  let buckets = [pixels];
  while (buckets.length < n) {
    let bi=0, br=0;
    for (let i=0;i<buckets.length;i++) {
      if (buckets[i].length<2) continue;
      const ch=widest(buckets[i]);
      const vals=buckets[i].map(p=>p[ch]);
      const range=Math.max(...vals)-Math.min(...vals);
      if (range>br){br=range;bi=i;}
    }
    const b=buckets[bi]; if(b.length<2)break;
    const ch=widest(b); b.sort((a,c)=>a[ch]-c[ch]);
    const m=b.length>>1;
    buckets.splice(bi,1,b.slice(0,m),b.slice(m));
  }
  return buckets.map(b => ({ rgb: avg(b), count: b.length }));
}

async function extractDominants(imagePath) {
  const { data } = await sharp(imagePath)
    .resize(80, 80, { fit: 'cover' })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i+1], data[i+2]]);
  return medianCut(px, 10).map(c => ({
    ...c,
    hsl: rgbToHsl(...c.rgb),
  }));
}

// ─── STEP 2: Select base (most "characterful" colour) ───

function selectBase(dominants) {
  // "Characterful" = S > 30% and L between 25-65% (widened to catch rich darks)
  const candidates = dominants.filter(c => c.hsl.s > 30 && c.hsl.l >= 25 && c.hsl.l <= 65);

  if (candidates.length > 0) {
    // Pick highest saturation among candidates
    candidates.sort((a, b) => b.hsl.s - a.hsl.s);
    const pick = candidates[0];
    // Ensure minimum vibrancy (65% sat — the "Flowline standard")
    // and usable lightness (35-45% for rich, deep backgrounds)
    const hsl = {
      h: pick.hsl.h,
      s: Math.max(pick.hsl.s, 65),
      l: Math.max(Math.min(pick.hsl.l, 45), 35),
    };
    return { hsl, rgb: pick.rgb, nudged: false };
  }

  // No characterful colour — find the most chromatic mid-tone
  let best = null;
  for (const c of dominants) {
    if (c.hsl.l > 15 && c.hsl.l < 85 && c.hsl.s > 2) {
      if (!best || c.hsl.s > best.hsl.s) best = c;
    }
  }
  const h = best ? best.hsl.h : 0;
  return {
    hsl: { h, s: 65, l: 40 },
    rgb: best ? best.rgb : [128, 128, 128],
    nudged: true,
  };
}

// ─── STEP 3: Generate accent (near-complement, matched energy) ───

function generateAccent(bgHsl) {
  // Rotate hue 140-170° (near-complement zone, NOT exactly 180°)
  const accentHue = (bgHsl.h + 155) % 360;

  // Accent saturation: at LEAST as saturated as bg, boosted 15-20%
  // Floor of 55% ensures accent is never washed out
  const accentSat = Math.min(100, Math.max(55, bgHsl.s * 1.2));

  // Accent lightness: 70-80% — vivid but readable, never pastel
  // Flowline's accent sits at ~75% which is the sweet spot
  const rawL = bgHsl.l + 30;
  const accentL = Math.max(70, Math.min(80, rawL));

  return { h: accentHue, s: accentSat, l: accentL };
}

// ─── Contrast enforcement ───

function enforceContrast(bgHsl, accentHsl) {
  const mode = bgHsl.l < 50 ? 'light' : 'dark';
  const textRgb = mode === 'light' ? [240, 240, 240] : [26, 26, 26];
  let warnings = [];

  let bgRgb = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);

  // Enforce body text >= 4.5:1
  let textCR = contrastRatio(bgRgb, textRgb);
  while (textCR < 4.5 && bgHsl.l > 5) {
    bgHsl.l -= 1;
    bgRgb = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);
    textCR = contrastRatio(bgRgb, textRgb);
  }
  if (textCR < 4.5) warnings.push(`text ${textCR.toFixed(2)}:1`);

  // Enforce accent >= 3:1 (lighten accent)
  let accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
  let accentCR = contrastRatio(bgRgb, accentRgb);
  while (accentCR < 3 && accentHsl.l < 96) {
    accentHsl.l += 1;
    accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
    accentCR = contrastRatio(bgRgb, accentRgb);
  }
  if (accentCR < 3) warnings.push(`accent ${accentCR.toFixed(2)}:1`);

  return { bgHsl, accentHsl, bgRgb, accentRgb, textRgb, textCR, accentCR, mode, warnings };
}

// ─── Ensure ALL slides have distinct hues (global distribution) ───

function hueDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 360 - d); }

const MIN_HUE_DIST = 45; // Minimum degrees between any two slides

function ensureVariety(palettes, projectIds) {
  // Process order: place slides with the most unique extracted hues first,
  // so they anchor the distribution and others adjust around them.
  // This naturally preserves Flowline-quality palettes.
  const entries = projectIds.filter(id => palettes[id]).map(id => ({
    id,
    origHue: palettes[id]._bgHsl.h,
  }));

  // Score uniqueness: how far is each hue from its nearest neighbour?
  for (const e of entries) {
    e.uniqueness = Math.min(
      ...entries.filter(o => o.id !== e.id).map(o => hueDist(e.origHue, o.origHue))
    );
  }
  // Sort: most unique first (they anchor), most common last (they shift)
  const order = [...entries].sort((a, b) => b.uniqueness - a.uniqueness);

  const placed = []; // { id, hue }

  for (const entry of order) {
    const myHue = entry.origHue;
    const tooClose = placed.some(p => hueDist(myHue, p.hue) < MIN_HUE_DIST);

    if (!tooClose) {
      // This hue is fine — place it as-is
      placed.push({ id: entry.id, hue: myHue });
      continue;
    }

    // Need to shift — find the largest gap in placed hues
    const sorted = placed.map(p => p.hue).sort((a, b) => a - b);
    let bestGapCenter = 0, bestGapSize = 0;
    for (let j = 0; j < sorted.length; j++) {
      const next = j === sorted.length - 1 ? sorted[0] + 360 : sorted[j + 1];
      const gap = next - sorted[j];
      if (gap > bestGapSize) {
        bestGapSize = gap;
        bestGapCenter = (sorted[j] + gap / 2) % 360;
      }
    }

    const newH = bestGapCenter;
    placed.push({ id: entry.id, hue: newH });

    // Update the palette with the new hue
    const p = palettes[entry.id];
    const newBgRgb = hslToRgb(newH, p._bgHsl.s, p._bgHsl.l);
    const newAccentHsl = generateAccent({ h: newH, s: p._bgHsl.s, l: p._bgHsl.l });
    const newAccentRgb = hslToRgb(newAccentHsl.h, newAccentHsl.s, newAccentHsl.l);

    p.background = rgbToHex(...newBgRgb);
    p.accent = rgbToHex(...newAccentRgb);
    p.wash = `rgba(${newBgRgb[0]}, ${newBgRgb[1]}, ${newBgRgb[2]}, 0.7)`;
    p._bgRgb = newBgRgb;
    p._bgHsl = { h: newH, s: p._bgHsl.s, l: p._bgHsl.l };
    p._accentHsl = newAccentHsl;
    p._shifted = true;

    console.log(`    → ${entry.id}: hue ${myHue.toFixed(0)}° too close, shifted to ${newH.toFixed(0)}° (largest gap: ${bestGapSize.toFixed(0)}°)`);
  }
}

// ─── Main ───

async function main() {
  console.log('\n  Palette Generation (Robin-Noguier method)\n  ══════════════════════════════════════════\n');

  const palettes = {};

  for (const project of PROJECTS) {
    const imagePath = join(ROOT, 'public', 'thumbnails', project.file);
    if (!existsSync(imagePath)) { console.log(`  ⚠ ${project.id}: not found`); continue; }

    // Step 1: Extract 10 dominant colours at 80x80
    const dominants = await extractDominants(imagePath);

    // Step 2: Select most characterful as background base
    const base = selectBase(dominants);
    const bgHsl = base.hsl;

    // Step 3: Generate accent via near-complement rotation + matched energy
    const accentHsl = generateAccent(bgHsl);

    // Step 6: Enforce contrast ratios
    const result = enforceContrast(bgHsl, accentHsl);

    // Output
    const bgHex = rgbToHex(...result.bgRgb);
    const accentHex = rgbToHex(...result.accentRgb);
    const textHex = result.mode === 'light' ? '#f0f0f0' : '#1a1a1a';
    const wash = `rgba(${result.bgRgb[0]}, ${result.bgRgb[1]}, ${result.bgRgb[2]}, 0.7)`;

    palettes[project.id] = {
      background: bgHex,
      accent: accentHex,
      text: textHex,
      textMode: result.mode,
      wash,
      // Internal metadata for variety pass
      _bgRgb: result.bgRgb,
      _bgHsl: result.bgHsl,
      _accentHsl: result.accentHsl,
      _nudged: base.nudged,
    };

    // Print reasoning
    const hueRot = ((result.accentHsl.h - base.hsl.h + 360) % 360).toFixed(0);
    const nudge = base.nudged ? ' [nudged]' : '';
    const srcHex = rgbToHex(...base.rgb);
    console.log(`  ${project.id}: src=${srcHex} → bg=${bgHex} (${base.hsl.h.toFixed(0)}° S:${base.hsl.s.toFixed(0)}% L:${result.bgHsl.l.toFixed(0)}%${nudge}) → accent=${accentHex} (hue +${hueRot}°, S:${result.accentHsl.s.toFixed(0)}% L:${result.accentHsl.l.toFixed(0)}%) — contrast ${result.accentCR.toFixed(1)}:1`);
    if (result.warnings.length) console.log(`    ⚠ ${result.warnings.join(', ')}`);
  }

  // Ensure consecutive slides have distinct hues
  ensureVariety(palettes, PROJECTS.map(p => p.id));

  // Clean internal metadata and save
  for (const id of Object.keys(palettes)) {
    const shifted = palettes[id]._shifted;
    delete palettes[id]._bgRgb;
    delete palettes[id]._bgHsl;
    delete palettes[id]._accentHsl;
    delete palettes[id]._nudged;
    delete palettes[id]._shifted;
    if (shifted) console.log(`  ${id}: ↻ hue shifted for variety`);
  }

  writeFileSync(join(ROOT, 'src', 'data', 'palettes.json'), JSON.stringify(palettes, null, 2));
  console.log('\n  ✓ Saved to src/data/palettes.json\n');
}

main().catch(err => { console.error(err); process.exit(1); });
