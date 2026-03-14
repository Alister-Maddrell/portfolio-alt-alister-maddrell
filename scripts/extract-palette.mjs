/**
 * extract-palette.mjs
 * Robin-Noguier-style palette generation with pop-art energy.
 *
 * Colour logic:
 *   ONE leads, ONE supports. The pair shares tonal DNA.
 *   Vivid dominant  → TINT: bg = bold hue, title = same hue tint (lighter, less saturated)
 *   Muted dominant  → COMPLEMENT: bg = dominant, title = complement at matched saturation
 *   Neutral dominant → NEUTRAL+CHROMATIC: dark bg, title = vivid secondary colour
 *
 * Clusters scored by count * saturation (not raw count) so brand colours
 * beat page backgrounds.
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
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = relativeLuminance(r1, g1, b1), l2 = relativeLuminance(r2, g2, b2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hueDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 360 - d); }

// ─── Median-cut ───

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

// ─── Extract ───

async function extractClusters(imagePath) {
  const { data } = await sharp(imagePath)
    .resize(80, 80, { fit: 'cover' })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i+1], data[i+2]]);
  return medianCut(px, 8).map(c => {
    const hsl = rgbToHsl(...c.rgb);
    return { ...c, hsl };
  });
}

// ─── Find character colour ───
// The most chromatic mid-tone cluster — the colour that gives the image its personality.
// Prioritises saturation and usable lightness (L 20–70) over raw pixel count.

function findCharacterColour(clusters) {
  let best = null, bestScore = 0;
  for (const c of clusters) {
    const { s, l } = c.hsl;
    // Lightness weight peaks at L:35-55 (ideal bg range)
    let lw = 1;
    if (l < 10 || l > 92) lw = 0;
    else if (l < 20 || l > 80) lw = 0.15;
    else if (l < 25 || l > 70) lw = 0.5;
    // Saturation is king — minimum 8 to qualify
    if (s < 8) continue;
    const score = s * lw * Math.sqrt(c.count);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ─── Strategy selection ───

function pickStrategy(clusters) {
  const character = findCharacterColour(clusters);

  if (character && character.hsl.s >= 35) {
    // Vivid character → TINT (same hue family, bold bg + soft accent)
    return tintMethod(character.hsl.h, character.hsl.s);
  }

  if (character && character.hsl.s >= 15) {
    // Muted but chromatic → COMPLEMENT
    return complementMethod(character.hsl.h, character.hsl.s);
  }

  // Truly neutral image — use the image's subtle colour temperature
  // Weight by saturation AND count to find the true tonal character
  let bestH = 30, bestWeight = 0;
  for (const c of clusters) {
    if (c.hsl.l > 15 && c.hsl.l < 85 && c.hsl.s > 2) {
      const w = c.hsl.s * Math.sqrt(c.count);
      if (w > bestWeight) { bestWeight = w; bestH = c.hsl.h; }
    }
  }
  // Boost into bold palette — pop-art rule
  return tintMethod(bestH, 55);
}

// ─── Palette strategies ───

function tintMethod(hue, sat) {
  // Bold saturated bg, tinted title with enough colour for pop-art energy
  return {
    strategy: 'TINT',
    bgHsl:    { h: hue, s: Math.max(sat, 55), l: 42 },
    titleHsl: { h: hue, s: 38, l: 82 },
  };
}

function complementMethod(hue, sat) {
  // Darker saturated bg, vivid complement accent — clear distinction from TINT
  const titleHue = (hue + 180) % 360;
  return {
    strategy: 'COMPLEMENT',
    bgHsl:    { h: hue, s: Math.max(sat + 10, 50), l: 26 },
    titleHsl: { h: titleHue, s: Math.max(sat, 45), l: 72 },
  };
}

// ─── Contrast enforcement ───

function enforce(bgHsl, titleHsl) {
  const textRgb = bgHsl.l < 50 ? [240, 240, 240] : [13, 13, 13];

  let bg = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);
  let textCR = contrastRatio(bg.r, bg.g, bg.b, ...textRgb);
  while (textCR < 4.5 && bgHsl.l > 8) {
    bgHsl.l -= 1;
    bg = hslToRgb(bgHsl.h, bgHsl.s, bgHsl.l);
    textCR = contrastRatio(bg.r, bg.g, bg.b, ...textRgb);
  }

  let title = hslToRgb(titleHsl.h, titleHsl.s, titleHsl.l);
  let titleCR = contrastRatio(bg.r, bg.g, bg.b, title.r, title.g, title.b);
  while (titleCR < 3 && titleHsl.l < 95) {
    titleHsl.l += 1;
    title = hslToRgb(titleHsl.h, titleHsl.s, titleHsl.l);
    titleCR = contrastRatio(bg.r, bg.g, bg.b, title.r, title.g, title.b);
  }

  return {
    bgHsl, titleHsl,
    bgRgb: [bg.r, bg.g, bg.b],
    titleRgb: [title.r, title.g, title.b],
    textRgb,
    textCR: textCR.toFixed(2),
    titleCR: titleCR.toFixed(2),
  };
}

// ─── Post-process: ensure variety ───

function ensureVariety(results) {
  // Build a list of "taken" hue slots. When a project collides,
  // try: 1) flip to COMPLEMENT, 2) shift +90°, 3) shift +180°
  const taken = [];

  for (const r of results) {
    const collisions = taken.filter(h => hueDist(h, r.bgHsl.h) < 35);

    if (collisions.length === 0) {
      taken.push(r.bgHsl.h);
      continue;
    }

    if (collisions.length === 1 && r.strategy === 'TINT') {
      // First collision — flip to COMPLEMENT (same hue, opposite accent)
      const h = r.bgHsl.h;
      const s = r.bgHsl.s;
      r.strategy = 'COMPLEMENT';
      r.bgHsl = { h, s: Math.max(s, 50), l: 26 };
      r.titleHsl = { h: (h + 180) % 360, s: Math.max(s - 5, 45), l: 72 };
      taken.push(h);
    } else {
      // Too crowded — rotate hue to find an open slot
      for (const offset of [90, 180, 270, 45, 135]) {
        const newH = (r.bgHsl.h + offset) % 360;
        if (taken.every(h => hueDist(h, newH) >= 35)) {
          r.bgHsl.h = newH;
          r.titleHsl.h = r.strategy === 'COMPLEMENT'
            ? (newH + 180) % 360 : newH;
          taken.push(newH);
          break;
        }
      }
    }
  }
}

// ─── Main ───

async function main() {
  console.log('\n  Palette Generation (Robin-style)\n  ════════════════════════════════\n');

  const results = [];

  for (const project of PROJECTS) {
    const imagePath = join(ROOT, 'public', 'thumbnails', project.file);
    if (!existsSync(imagePath)) { console.log(`  ⚠ ${project.id}: not found`); continue; }

    const clusters = await extractClusters(imagePath);
    const character = findCharacterColour(clusters);
    const result = pickStrategy(clusters);
    result.id = project.id;
    result.character = character || clusters[0];
    results.push(result);
  }

  // Sort by character saturation — vivid images keep their hue, neutral ones get shifted
  const order = results.map((r, i) => i);
  const sortedByPriority = [...results].sort((a, b) => b.character.hsl.s - a.character.hsl.s);
  ensureVariety(sortedByPriority);
  // Restore original order
  results.length = 0;
  results.push(...order.map(i => sortedByPriority.find(r => r.id === PROJECTS[i].id)));

  // Enforce contrast and output
  const palettes = {};

  for (const r of results) {
    const final = enforce(r.bgHsl, r.titleHsl);
    const bgHex = rgbToHex(...final.bgRgb);
    const titleHex = rgbToHex(...final.titleRgb);
    const textMode = final.bgHsl.l < 50 ? 'light' : 'dark';
    const textHex = textMode === 'light' ? '#f0f0f0' : '#0d0d0d';
    const washHex = rgbToHex(...final.bgRgb.map(c => Math.round(c * 0.7 + 255 * 0.3)));

    palettes[r.id] = { background: bgHex, accent: titleHex, text: textHex, textMode, wash: washHex };

    const cHex = rgbToHex(...r.character.rgb);
    console.log(`  ${r.id.toUpperCase()}`);
    console.log(`    Character:   ${cHex}  H:${r.character.hsl.h.toFixed(0)}  S:${r.character.hsl.s.toFixed(0)}  L:${r.character.hsl.l.toFixed(0)}`);
    console.log(`    Strategy:    ${r.strategy}`);
    console.log(`    Background:  ${bgHex}  (H:${final.bgHsl.h.toFixed(0)} S:${final.bgHsl.s.toFixed(0)} L:${final.bgHsl.l.toFixed(0)})`);
    console.log(`    Accent:      ${titleHex}  (H:${final.titleHsl.h.toFixed(0)} S:${final.titleHsl.s.toFixed(0)} L:${final.titleHsl.l.toFixed(0)})`);
    console.log(`    Text:        ${textHex}  Wash: ${washHex}`);
    console.log(`    Contrast:    title ${final.titleCR}:1   text ${final.textCR}:1`);
    console.log('');
  }

  writeFileSync(join(ROOT, 'src', 'data', 'palettes.json'), JSON.stringify(palettes, null, 2));
  console.log('  ✓ Saved to src/data/palettes.json\n');
}

main().catch(err => { console.error(err); process.exit(1); });
