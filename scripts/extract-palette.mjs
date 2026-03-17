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

// Pinned palettes — these are locked and skip generation entirely.
// Pop art: deeply saturated backgrounds + bright complementary accents.
// Each slide is a distinct hue with maximum chroma clash.
const PINNED = {
  hartley: {
    background: '#0652DD', accent: '#FFC312', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(6, 82, 221, 0.7)',
  },
  kin: {
    // H:355° crimson + chartreuse glow (H:68°) — warm lime, no clash
    background: '#BD1F2C', accent: '#D8EB5C', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(189, 31, 44, 0.7)',
  },
  apex: {
    // H:187° cyan + lemon-yellow glow (H:58°) — brighter, distinct from Hartley gold
    background: '#00BCD4', accent: '#EDE95C', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(0, 188, 212, 0.7)',
  },
  whitfield: {
    // H:252° indigo (S:65%, softer) + spring green glow (H:92°) — Mardi Gras pop
    background: '#4125B1', accent: '#A4E76A', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(65, 37, 177, 0.7)',
  },
  luma: {
    background: '#b12562', accent: '#80ef91', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(177, 37, 98, 0.7)',
  },
  flowline: {
    background: '#8E24AA', accent: '#FFEB3B', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(142, 36, 170, 0.7)',
  },
  evergreen: {
    // H:162° jade teal + warm gold glow (H:42°) — cooler green, richer accent
    background: '#0F9B72', accent: '#F2C44E', text: '#f0f0f0',
    textMode: 'light', wash: 'rgba(15, 155, 114, 0.7)',
  },
};

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

// ─── Hue-aware quality curve ───
// Not all hues look equally good at the same S/L. Purple and magenta
// are naturally jewel-toned at S:65% L:40%. Orange becomes rust. Yellow
// becomes olive. This curve adjusts per hue zone so every color pops.

function hueAdjustBg(h, s, l) {
  // Reds/oranges (345-45°): push saturation higher, raise lightness to avoid rust
  if (h >= 345 || h < 45) {
    // Cap saturation to prevent harsh/burnt look; push toward richer tones
    // Shift oranges (15-40°) toward crimson/red for more premium feel
    return { s: Math.max(Math.min(s, 75), 65), l: Math.max(Math.min(l, 42), 35),
             hShift: (h >= 15 && h < 40) ? Math.max(0, h - 12) : undefined };
  }
  // Yellows/golds (45-75°): need L>50% to flip to dark text mode.
  // Dark yellow = olive = ugly. Bright golden yellow with dark text = vibrant.
  if (h >= 45 && h < 75) {
    return { s: Math.max(s, 65), l: Math.max(Math.min(l, 58), 52) };
  }
  // Greens (75-160°): high luminance channel — needs darker L for text contrast
  // Also cap saturation to prevent garish/cheap look
  if (h >= 75 && h < 160) {
    return { s: Math.max(Math.min(s, 58), 48), l: Math.max(Math.min(l, 34), 26) };
  }
  // Teals/cyans (160-200°): same luminance issue as greens — go darker
  if (h >= 160 && h < 200) {
    return { s: Math.max(s, 68), l: Math.max(Math.min(l, 36), 28) };
  }
  // Blues (200-260°): rich and premium at default values
  if (h >= 200 && h < 260) {
    return { s: Math.max(s, 65), l: Math.max(Math.min(l, 45), 35) };
  }
  // Purples (260-310°): jewel-toned sweet spot — the Flowline zone
  if (h >= 260 && h < 310) {
    return { s: Math.max(s, 65), l: Math.max(Math.min(l, 45), 35) };
  }
  // Magentas/pinks (310-345°): rich plum/berry — the Luma zone
  return { s: Math.max(s, 65), l: Math.max(Math.min(l, 42), 33) };
}

// Accent hue quality: prevent electric cyans, washed pastels
function hueAdjustAccent(h, s, l) {
  // Cyans (160-200°): cap saturation to prevent electric/neon look
  if (h >= 160 && h < 200) {
    return { s: Math.min(s, 70), l: Math.max(Math.min(l, 78), 72) };
  }
  // Yellows/golds (30-80°): these look best slightly warmer and richer
  if (h >= 30 && h < 80) {
    return { s: Math.max(s, 60), l: Math.max(Math.min(l, 78), 72) };
  }
  // Pinks (300-360°): prevent pastels, keep vivid
  if (h >= 300 || h < 15) {
    return { s: Math.max(s, 55), l: Math.max(Math.min(l, 78), 70) };
  }
  // Default: keep vivid but not jarring
  return { s: Math.max(Math.min(s, 80), 55), l: Math.max(Math.min(l, 78), 70) };
}

// ─── STEP 2: Select base (most "characterful" colour) ───

function selectBase(dominants) {
  // "Characterful" = S > 30% and L between 25-65% (widened to catch rich darks)
  const candidates = dominants.filter(c => c.hsl.s > 30 && c.hsl.l >= 25 && c.hsl.l <= 65);

  if (candidates.length > 0) {
    // Pick highest saturation among candidates
    candidates.sort((a, b) => b.hsl.s - a.hsl.s);
    const pick = candidates[0];
    // Apply hue-aware adjustment curve (may include hue shift for oranges→crimson)
    const adj = hueAdjustBg(pick.hsl.h, Math.max(pick.hsl.s, 65), pick.hsl.l);
    const hsl = {
      h: adj.hShift !== undefined ? adj.hShift : pick.hsl.h,
      s: adj.s,
      l: adj.l,
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
  const adj = hueAdjustBg(h, 65, 40);
  return {
    hsl: { h: adj.hShift !== undefined ? adj.hShift : h, s: adj.s, l: adj.l },
    rgb: best ? best.rgb : [128, 128, 128],
    nudged: true,
  };
}

// ─── STEP 3: Generate accent (near-complement, matched energy) ───

function generateAccent(bgHsl) {
  // Rotate hue 140-170° (near-complement zone, NOT exactly 180°)
  const accentHue = (bgHsl.h + 155) % 360;

  // Base accent: at least as saturated as bg, boosted 20%
  const rawSat = Math.min(100, Math.max(55, bgHsl.s * 1.2));
  const rawL = Math.max(70, Math.min(80, bgHsl.l + 30));

  // Apply hue-aware accent curve (prevents electric cyans, washed pastels)
  const adj = hueAdjustAccent(accentHue, rawSat, rawL);

  return { h: accentHue, s: adj.s, l: adj.l };
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

  // Enforce accent >= 3:1
  // Dark mode (bright bg): darken accent for contrast. Light mode (dark bg): lighten accent.
  let accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
  let accentCR = contrastRatio(bgRgb, accentRgb);
  const origAccentL = accentHsl.l;

  if (mode === 'dark') {
    // Bright bg — accent needs to go darker and more saturated for contrast
    accentHsl.l = Math.min(accentHsl.l, 40); // Start from dark side
    accentHsl.s = Math.max(accentHsl.s, 70); // Keep vivid
    accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
    accentCR = contrastRatio(bgRgb, accentRgb);
    while (accentCR < 3 && accentHsl.l > 5) {
      accentHsl.l -= 1;
      accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
      accentCR = contrastRatio(bgRgb, accentRgb);
    }
  } else {
    // Dark bg — accent goes lighter
    while (accentCR < 3 && accentHsl.l < 96) {
      accentHsl.l += 1;
      // If we've pushed lightness 6+ pts beyond target, boost saturation to stay vivid
      if (accentHsl.l > origAccentL + 6 && accentHsl.s < 90) {
        accentHsl.s = Math.min(90, accentHsl.s + 2);
      }
      accentRgb = hslToRgb(accentHsl.h, accentHsl.s, accentHsl.l);
      accentCR = contrastRatio(bgRgb, accentRgb);
    }
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

  // Pinned palettes go first — they always anchor
  const pinned = entries.filter(e => palettes[e.id]._pinned);
  const unpinned = entries.filter(e => !palettes[e.id]._pinned);

  // Score uniqueness among unpinned: how far is each hue from its nearest neighbour?
  for (const e of unpinned) {
    e.uniqueness = Math.min(
      ...entries.filter(o => o.id !== e.id).map(o => hueDist(e.origHue, o.origHue))
    );
  }
  // Sort: most unique first (they anchor), most common last (they shift)
  const order = [...pinned, ...unpinned.sort((a, b) => b.uniqueness - a.uniqueness)];

  const placed = []; // { id, hue }

  for (const entry of order) {
    const myHue = entry.origHue;

    // Pinned entries are always placed as-is
    if (palettes[entry.id]._pinned) {
      placed.push({ id: entry.id, hue: myHue });
      continue;
    }

    const tooClose = placed.some(p => hueDist(myHue, p.hue) < MIN_HUE_DIST);

    if (!tooClose) {
      placed.push({ id: entry.id, hue: myHue });
      continue;
    }

    // Need to shift — find the best placement that maximises minimum distance
    // Avoid 45-75° yellow zone (dark yellow = olive, bright yellow needs dark text mode)
    const isYellowZone = (h) => h >= 45 && h < 75;
    const scoreHue = (h) => isYellowZone(h) ? -1 : Math.min(...placed.map(p => hueDist(h, p.hue)));

    // Try every 5° around the wheel, pick the one with the best minimum distance
    let bestH = 0, bestScore = -1;
    for (let candidate = 0; candidate < 360; candidate += 5) {
      const score = scoreHue(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestH = candidate;
      }
    }

    const newH = bestH;
    placed.push({ id: entry.id, hue: newH });

    // Update the palette with the new hue, applying hue-aware adjustments
    const p = palettes[entry.id];
    const adj = hueAdjustBg(newH, p._bgHsl.s, p._bgHsl.l);
    const adjustedH = adj.hShift !== undefined ? adj.hShift : newH;
    const newBgHsl = { h: adjustedH, s: adj.s, l: adj.l };
    const newAccentHsl = generateAccent(newBgHsl);

    // Re-run contrast enforcement (critical — shifted hues have different luminance)
    const result = enforceContrast(newBgHsl, newAccentHsl);

    p.background = rgbToHex(...result.bgRgb);
    p.accent = rgbToHex(...result.accentRgb);
    p.text = result.mode === 'light' ? '#f0f0f0' : '#1a1a1a';
    p.textMode = result.mode;
    p.wash = `rgba(${result.bgRgb[0]}, ${result.bgRgb[1]}, ${result.bgRgb[2]}, 0.7)`;
    p._bgRgb = result.bgRgb;
    p._bgHsl = result.bgHsl;
    p._accentHsl = result.accentHsl;
    p._shifted = true;

    console.log(`    → ${entry.id}: hue ${myHue.toFixed(0)}° too close, shifted to ${newH.toFixed(0)}° (min distance: ${bestScore.toFixed(0)}°)`);
  }
}

// ─── Main ───

async function main() {
  console.log('\n  Palette Generation (Robin-Noguier method)\n  ══════════════════════════════════════════\n');

  const palettes = {};

  // Insert pinned palettes first (they anchor the variety pass)
  for (const [id, pin] of Object.entries(PINNED)) {
    const bgRgb = hslToRgb(...Object.values(rgbToHsl(
      parseInt(pin.background.slice(1,3),16),
      parseInt(pin.background.slice(3,5),16),
      parseInt(pin.background.slice(5,7),16)
    )));
    const bgHsl = rgbToHsl(bgRgb[0], bgRgb[1], bgRgb[2]);
    palettes[id] = { ...pin, _bgRgb: bgRgb, _bgHsl: bgHsl, _accentHsl: bgHsl, _nudged: false, _pinned: true };
    console.log(`  ${id}: 📌 pinned (bg=${pin.background} accent=${pin.accent})`);
  }

  for (const project of PROJECTS) {
    if (PINNED[project.id]) continue; // Skip pinned projects
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
    delete palettes[id]._pinned;
    if (shifted) console.log(`  ${id}: ↻ hue shifted for variety`);
  }

  writeFileSync(join(ROOT, 'src', 'data', 'palettes.json'), JSON.stringify(palettes, null, 2));
  console.log('\n  ✓ Saved to src/data/palettes.json\n');
}

main().catch(err => { console.error(err); process.exit(1); });
