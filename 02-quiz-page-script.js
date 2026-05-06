/* ═══════════════════════════════════════════════════════════════
   LaptopLab — Quiz JS (path-guarded)
   Loads from Marketing → Cod personalizat → runs site-wide.
   The path guard ensures it only executes on the quiz page.
   Wait for DOMContentLoaded so .lab-quiz markup is in the DOM.

   Diagnostic console.log markers help us see JS state at a glance:
     [LaptopLab] script loaded   → JS file IS reaching the page
     [LaptopLab] not quiz page   → loaded but path-guard rejected (wrong slug)
     [LaptopLab] no .lab-quiz    → loaded, path correct, but markup missing
     [LaptopLab] init OK         → all good, quiz is wired up
   If you see NONE of these in the console, the JS file isn't being loaded
   at all — check Marketing → Cod personalizat or wherever you pasted it.
═══════════════════════════════════════════════════════════════ */
console.log('[LaptopLab] script loaded — path:', location.pathname);
(function() {
  'use strict';
  function init() {
    if (location.pathname !== '/gaseste-laptopul-potrivit') {
      console.log('[LaptopLab] not quiz page — skipping init');
      return;
    }
    if (!document.querySelector('.lab-quiz')) {
      console.warn('[LaptopLab] no .lab-quiz element found — markup missing or not loaded yet');
      return;
    }
    console.log('[LaptopLab] init OK');

/* ══════════════════════════════════════
   QUIZ STATE MACHINE
══════════════════════════════════════ */
const QUIZ = {
  answers: { purpose: null, budget: null, size: null },
  history: [1]
};

const quizEl = document.getElementById('quiz');
const steps  = quizEl.querySelectorAll('.quiz-step');
const result = quizEl.querySelector('.quiz-result');

/** Show a step by its data-step value ("1" / "2" / "3" / "result") */
function showStep(s) {
  steps.forEach(el => el.style.display = 'none');
  result.classList.remove('show');
  result.style.display = 'none';

  if (s === 'result') {
    result.style.display = 'block';
    result.classList.add('show');
    renderRecap();
    loadAndMatch();
  } else {
    const target = quizEl.querySelector('.quiz-step[data-step="' + s + '"]');
    if (target) target.style.display = 'block';
  }
  // Keep focus at top of quiz card for accessibility
  quizEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* Wire up option buttons */
quizEl.querySelectorAll('.quiz-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    const key   = opt.dataset.answer;
    const value = opt.dataset.value;
    const label = opt.dataset.label;
    const emoji = opt.dataset.emoji;
    QUIZ.answers[key] = { value, label, emoji };
    const next = opt.dataset.next;
    QUIZ.history.push(next);
    showStep(next);
  });
});

/* Back buttons */
quizEl.querySelectorAll('.quiz-back').forEach(btn => {
  btn.addEventListener('click', () => {
    const back = btn.dataset.back;
    // Remove last answer logically
    if (back === '1') QUIZ.answers.purpose = null;
    if (back === '2') QUIZ.answers.budget  = null;
    showStep(back);
  });
});

/* Restart */
document.getElementById('restartBtn').addEventListener('click', () => {
  QUIZ.answers = { purpose: null, budget: null, size: null };
  QUIZ.history = [1];
  showStep('1');
});

/* Render the "your answers" chips on the result page */
function renderRecap() {
  const wrap = document.getElementById('answersRecap');
  const a = QUIZ.answers;
  const items = [];
  if (a.purpose) items.push(a.purpose);
  if (a.budget)  items.push(a.budget);
  if (a.size)    items.push(a.size);
  wrap.innerHTML = items.map(i => `<span class="answer-chip"> <span class="answer-chip-emoji">${i.emoji}</span>${i.label} </span>`).join('');
}

/* ══════════════════════════════════════
   LIVE PRODUCT MATCHING — Gomag XML feed
   Strategy:
   1. Fetch feed (googleShoppingAds.xml)
   2. Filter in-stock products that match budget window
   3. Score each against purpose (CPU keywords) + size
   4. Pick 3 tiers:
      - BEST = highest score
      - CHEAPER = lowest price in matching set
      - STRONGER = highest-priced (within reason)
   5. If no matches, relax filters progressively
   6. If feed fails entirely, show static fallback
══════════════════════════════════════ */
const FEED_URL = 'https://www.laptoplab.ro/feed/googleShoppingAds.xml';

/* ─── Shared feed fetch cache ───
   We fetch the feed at most once per page load. Both:
     • The early prefetch (on DOMContentLoaded) — for the skip-count
     • loadAndMatch() — when the user reaches the result step
   share the same Promise via getFeedXMLDoc(). */
let _feedDocPromise = null;
function getFeedXMLDoc() {
  if (_feedDocPromise) return _feedDocPromise;
  _feedDocPromise = fetch(FEED_URL)
    .then(r => { if (!r.ok) throw new Error('feed http ' + r.status); return r.text(); })
    .then(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('feed parse error');
      return doc;
    });
  return _feedDocPromise;
}

/* ─── Prefetch the feed on page load to populate the live count
   in the quiz skip link ("Vezi toate cele N laptopuri") right away,
   before the user reaches the result step. */
(function prefetchSkipCount() {
  const skipEl = document.getElementById('quizSkipCount');
  if (!skipEl) return;
  getFeedXMLDoc().then(doc => {
    const ns = 'http://base.google.com/ns/1.0';
    const items = Array.from(doc.querySelectorAll('item')).filter(it => {
      var _avEl = it.getElementsByTagNameNS(ns, 'availability')[0]; var av = (_avEl && _avEl.textContent) || '';
      return av.toLowerCase().includes('in_stock') || av.toLowerCase().includes('in stock');
    });
    if (items.length) skipEl.textContent = items.length;
  }).catch(() => { /* keep the placeholder */ });
})();

/* Budget windows — lei (non-overlapping, inclusive-exclusive except last) */
const BUDGET_RANGES = {
  'under500':  { min: 0,    max: 499,   label: 'sub 500 lei'       },
  '500-800':   { min: 500,  max: 799,   label: '500–800 lei'       },
  '800-1200':  { min: 800,  max: 1199,  label: '800–1.200 lei'     },
  'over1200':  { min: 1200, max: 99999, label: 'peste 1.200 lei'   }
};

/* Size windows — inches (extracted from title). Edges tuned to
   cover the real products in stock (11.6, 12.5, 13.3, 14, 15.6, 17.3 etc). */
const SIZE_RANGES = {
  'ultra':    { min: 10,   max: 12.9, label: '11–12″'     },
  'compact':  { min: 13,   max: 14.3, label: '13–14″'     },
  'standard': { min: 14.4, max: 16.1, label: '15.6″'      }, // includes 15.6
  'large':    { min: 16.2, max: 20,   label: '17″+'       },
  'any':      { min: 0,    max: 99,   label: 'orice'      }
};

/* Purpose → scoring keywords. Higher weight = bigger bonus.
   Rules match against the full title text (case-insensitive). */
const PURPOSE_SCORES = {
  'work': [
    { kw: /thinkpad|latitude|elitebook|probook/i,   w: 5 },  // Business-class machines
    { kw: /\bi[57][-\s]/i,                           w: 3 },  // i5/i7 CPUs
    { kw: /\bssd\b/i,                                w: 2 },  // SSD = snappy boot
    { kw: /\b(8|12|16)GB\s*RAM/i,                    w: 2 },  // 8GB+ RAM
    { kw: /\bTAST\.?\s*ILUM/i,                       w: 1 }   // Backlit keyboard bonus
  ],
  'school': [
    { kw: /\bi[35][-\s]|celeron/i,                   w: 3 },  // Entry/mid CPU
    { kw: /\bssd\b/i,                                w: 2 },
    { kw: /\b(4|8)GB\s*RAM/i,                        w: 2 },
    { kw: /chromebook|thinkpad|latitude|elitebook/i, w: 1 },
    { kw: /14inch|14"|13\.?\d/i,                     w: 1 }   // Portable for school
  ],
  'home': [
    { kw: /15\.6|15inch|15"/i,                       w: 3 },  // Bigger screen for home
    { kw: /\bi[35][-\s]|ryzen/i,                     w: 2 },
    { kw: /\bssd\b|\bhdd\b/i,                        w: 1 }
  ],
  'creative': [
    { kw: /\bi[79][-\s]|ryzen\s*[579]/i,             w: 5 },  // Powerful CPUs
    { kw: /\b(16|32)GB\s*RAM/i,                      w: 4 },  // Heavy RAM
    // DEDICATED GPU — both NVIDIA and AMD families
    { kw: /\b(nvidia|geforce|gtx|rtx|quadro|mx\s*\d{3})\b/i,      w: 4 },
    { kw: /\b(radeon|ati\s+radeon|firepro|rx\s*\d{3,4})\b/i,       w: 4 },
    { kw: /\bamd\s+(radeon|r[579]|hd\s*\d{4}|firepro)\b/i,         w: 3 },
    { kw: /\bssd\b/i,                                w: 2 },
    { kw: /\bTOUCH\b/i,                              w: 1 }   // Touch is nice-to-have for creative
  ]
};

/** Extract price as number from feed price string "1299.00 RON" */
function parsePrice(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

/** Extract screen size in inches from title.
    Handles: "14inch", "14.1inch", "14 inch", "14\"", "14.1\"",
             "15,6 inch" (comma decimal), "13,3\"", "14in", "15-15.6".
    Returns the first plausible value in [9, 22] inches or null. */
function parseSize(title) {
  if (!title) return null;
  // Try several patterns; first pattern to match wins.
  // Normalize commas to dots so "15,6" → "15.6"
  const t = title.replace(/(\d),(\d)/g, '$1.$2');

  // Pattern 1: digits + optional decimal + (inch|"|″|in word-boundary)
  let m = t.match(/(\d{2}(?:\.\d+)?)\s*(?:inch(?:es)?|"|″|in\b)/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 9 && n <= 22) return n;
  }

  // Pattern 2: "15.6 FHD", "14 FHD" — inch implied before common display resolutions
  m = t.match(/(\d{2}(?:\.\d+)?)\s*(?:FHD|HD|UHD|WQHD)/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 9 && n <= 22) return n;
  }

  // Pattern 3: standalone "15.6" or "14" preceded by space/start and followed by "inch" later in title
  if (/inch|″|"/.test(t)) {
    m = t.match(/(?:^|\s)(\d{2}(?:\.\d+)?)(?:\s|-)/);
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 9 && n <= 22) return n;
    }
  }

  return null;
}

/** Format price RO */
function fmtPrice(n) {
  if (n == null) return '';
  return Math.round(n).toLocaleString('ro-RO') + ' lei';
}

/** Clean up title: remove brand prefix, cap length (same as homepage) */
function cleanTitle(title, brand) {
  let t = title || '';
  t = t.replace(/^Laptop\s+(Second\s*Hand|Refurbished)\s+/i, '');
  if (brand) t = t.replace(new RegExp('^' + brand + '[\\s\\-–]?', 'i'), '');
  t = t.replace(/\s+Refurbished\s*$/i, '');
  t = t.replace(/\s+Windows\s+\d+\s*$/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  // Cut at first " - " if it's a meaningful model break
  const parts = t.split(/\s*-\s*/);
  if (parts[0].length >= 10) t = parts[0];
  if (t.length > 60) t = t.slice(0, 57) + '…';
  return t;
}

/** Extract specs snippet from title (compact) */
function extractSpecs(title) {
  if (!title) return '';
  const bits = [];
  // CPU
  const cpu = title.match(/\b(i[3579][\s-]?\d{3,4}\w*)\b/i)
           || title.match(/\b(Ryzen\s*\d+[\s\w-]*?\d{3,4}\w*)\b/i)
           || title.match(/\b(Celeron\s+\w+)/i);
  if (cpu) bits.push(cpu[1].replace(/\s+/g, '-').replace(/--+/g, '-'));
  // RAM
  const ram = title.match(/(\d{1,2})\s*GB\s*RAM/i);
  if (ram) bits.push(ram[1] + 'GB RAM');
  // Storage — SSD preferred
  const ssd = title.match(/(\d+)\s*GB\s*SSD/i);
  const hdd = title.match(/(\d+)\s*GB\s*HDD/i);
  if (ssd)      bits.push(ssd[1] + 'GB SSD');
  else if (hdd) bits.push(hdd[1] + 'GB HDD');
  // Screen size + resolution combined into one bit (e.g. "14″ FHD")
  const sz = title.match(/(\d{2}(?:\.\d)?)\s*(?:inch|"|″)/i);
  const res = detectResolution(title);
  if (sz && res)      bits.push(sz[1] + '″ ' + res);
  else if (sz)        bits.push(sz[1] + '″');
  else if (res)       bits.push(res);
  // OS — last so it never crowds the more important specs
  const os = detectOS(title);
  if (os) bits.push(os);
  return bits.slice(0, 6).join(' · ');
}

/** Detect OS from product title.
    Priority order matters: more specific matches first (e.g. Win 11 before
    Win 1, "Mac OS" before just "OS", "Ubuntu" before generic "Linux"). */
function detectOS(t) {
  if (!t) return '';
  const PATTERNS = [
    [/\bWin(?:dows)?\s*11\b/i,                  'Win 11'],
    [/\bWin(?:dows)?\s*10\b/i,                  'Win 10'],
    [/\bWin(?:dows)?\s*8\.1\b/i,                'Win 8.1'],
    [/\bWin(?:dows)?\s*8\b/i,                   'Win 8'],
    [/\bWin(?:dows)?\s*7\b/i,                   'Win 7'],
    [/\bWin(?:dows)?\s*XP\b/i,                  'Win XP'],
    [/\b(?:macOS|Mac\s*OS|OS\s*X)\b/i,          'macOS'],
    [/\bChrome\s*OS\b/i,                        'ChromeOS'],
    [/\bUbuntu\b/i,                             'Ubuntu'],
    [/\bLinux\b/i,                              'Linux'],
    [/\bFree\s*DOS\b/i,                         'FreeDOS'],
    [/\bFără?\s+OS\b|\bNo\s+OS\b/i,             'Fără OS']
  ];
  for (let i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i][0].test(t)) return PATTERNS[i][1];
  }
  return '';
}

/** Detect screen resolution label from title.
    Recognizes both pixel formats (1920x1080) and named labels (FHD, QHD).
    Priority highest-to-lowest so plain "HD" doesn't override "4K UHD". */
function detectResolution(t) {
  if (!t) return '';
  if (/\b3840\s*[x×]\s*2160\b|\b4K\b|\bUHD\b/i.test(t)) return '4K';
  if (/\b2560\s*[x×]\s*1440\b|\bQHD\b|\bWQHD\b|\b2K\b/i.test(t)) return 'QHD';
  if (/\bRetina\b/i.test(t)) return 'Retina';
  if (/\b1920\s*[x×]\s*1080\b|\bFHD\b|\bFull\s*HD\b/i.test(t)) return 'FHD';
  if (/\b1600\s*[x×]\s*900\b|\bHD\+\b/i.test(t)) return 'HD+';
  if (/\b1366\s*[x×]\s*768\b|\bHD\b/i.test(t)) return 'HD';
  return '';
}

/** Detect auto feature flags from title (Touch, KBD, GPU dedicated).
    Same engine as homepage — including AMD/ATI radeon detection. */
function extractFlags(title) {
  const t = title || '';
  return {
    touch: /\bTOUCH\b/i.test(t),
    kbd:   /\bTAST\.?\s*ILUM/i.test(t)
        || /\btastatur[aă]\s+ilumin/i.test(t)
        || /\bbacklit(\s+kb|\s+keyboard)?\b/i.test(t),
    // Dedicated GPU — NVIDIA + AMD families
    gpuDedicated:
         /\b(nvidia|geforce|gtx|rtx|quadro|mx\s*\d{3})\b/i.test(t)
      || /\b(radeon|ati\s+radeon|firepro|rx\s*\d{3,4})\b/i.test(t)
      || /\bamd\s+(radeon|r[579]|hd\s*\d{4}|firepro)\b/i.test(t),
    // RAM in GB for threshold checks
    ramGB: (() => { const m = t.match(/(\d{1,2})\s*GB\s*RAM/i); return m ? parseInt(m[1], 10) : null; })()
  };
}

/** Score a product against the chosen purpose */
function scorePurpose(title, purpose) {
  if (!purpose || !PURPOSE_SCORES[purpose]) return 0;
  let score = 0;
  PURPOSE_SCORES[purpose].forEach(rule => {
    if (rule.kw.test(title)) score += rule.w;
  });
  return score;
}

/** Build a product object from an XML <item> */
function buildProduct(item, ns) {
  var g = function(f) { var _el = item.getElementsByTagNameNS(ns, f)[0]; var _txt = _el && _el.textContent; return (_txt && _txt.trim()) || ''; };
  var tx = function(f) { var _el = item.querySelector(f); var _txt = _el && _el.textContent; return (_txt && _txt.trim()) || ''; };

  const title     = g('title')    || tx('title');
  const price     = parsePrice(g('price'));
  const salePrice = parsePrice(g('sale_price'));
  const effPrice  = salePrice && salePrice < price ? salePrice : price;
  const image     = g('image_link');
  const link      = g('link')     || tx('link');
  const brand     = g('brand');
  const avail     = g('availability');
  const size      = parseSize(title);
  const flags     = extractFlags(title);

  return {
    title, brand, image, link, avail,
    price, salePrice, effPrice, size,
    showSale: salePrice != null && price != null && salePrice < price,
    saleDiff: (price != null && salePrice != null) ? Math.round(price - salePrice) : 0,
    // Auto-detected feature flags (same engine as homepage)
    touch:        flags.touch,
    kbd:          flags.kbd,
    gpuDedicated: flags.gpuDedicated,
    ramGB:        flags.ramGB,
    cleanName: cleanTitle(title, brand),
    specs:     extractSpecs(title)
  };
}

/** Pick best 3 products from pool based on user answers.
 *
 *  Returns { best, cheaper, stronger, relaxed, stats } where:
 *    relaxed = {
 *      budgetWidened: false | { originalLabel, newLabel },
 *      sizeRelaxed:   false | { originalLabel },
 *      purposeIgnored: false,
 *      noMatchAtAll: false   // true when we fall back to full pool
 *    }
 *    stats = { strictCount, widenedCount, poolTotal }
 *
 *  Strategy — progressive relaxation so we ALWAYS show something,
 *  but we TELL the user what was relaxed.
 *
 *  Tier 1: strict budget + strict size + purpose score
 *  Tier 2: strict budget + RELAXED size + purpose score
 *  Tier 3: WIDENED budget (±25%) + RELAXED size
 *  Tier 4: any in-stock product sorted by purpose score
 */
function pickThree(pool, answers) {
  if (!pool.length) return null;

  const budgetCfg = BUDGET_RANGES[(answers.budget && answers.budget.value)];
  const sizeCfg   = SIZE_RANGES[(answers.size && answers.size.value)] || SIZE_RANGES.any;
  const budgetLabel = (budgetCfg && budgetCfg.label) || '';
  const sizeLabel   = (sizeCfg && sizeCfg.label)   || '';

  const inBudget = (p, range) =>
    range && p.effPrice != null &&
    p.effPrice >= range.min && p.effPrice <= range.max;

  const inSize = (p, range) => {
    // If user chose "any", always match
    if ((answers.size && answers.size.value) === 'any') return true;
    // If we know the size, enforce the window
    if (p.size != null) return p.size >= range.min && p.size <= range.max;
    // If size couldn't be parsed, EXCLUDE from strict match
    // (better to miss a few than to show wrong-size laptops)
    return false;
  };

  // ─── Tier 1: strict budget + strict size ───
  let matches = pool.filter(p => inBudget(p, budgetCfg) && inSize(p, sizeCfg));
  const strictCount = matches.length;
  let relaxed = { budgetWidened: false, sizeRelaxed: false, noMatchAtAll: false };

  // ─── Tier 2: strict budget + relaxed size ───
  if (matches.length < 3) {
    const tier2 = pool.filter(p => inBudget(p, budgetCfg));
    if (tier2.length > matches.length) {
      matches = tier2;
      if ((answers.size && answers.size.value) !== 'any' && strictCount < 3) {
        relaxed.sizeRelaxed = { originalLabel: sizeLabel };
      }
    }
  }

  // ─── Tier 3: widen budget by ±25% (still respect relaxed size) ───
  let widenedCount = matches.length;
  if (matches.length < 3 && budgetCfg) {
    const widened = {
      min: Math.max(0, Math.floor(budgetCfg.min * 0.75)),
      max: Math.ceil(budgetCfg.max * 1.25)
    };
    const tier3 = pool.filter(p => inBudget(p, widened));
    if (tier3.length > matches.length) {
      matches = tier3;
      widenedCount = tier3.length;
      relaxed.budgetWidened = {
        originalLabel: budgetLabel,
        newLabel: `${fmtPrice(widened.min)} – ${fmtPrice(widened.max)}`
      };
    }
  }

  // ─── Tier 4: last resort — any in-stock product ───
  if (matches.length < 1) {
    matches = pool.slice();
    relaxed.noMatchAtAll = true;
  }

  if (!matches.length) return null;

  // Score all remaining against purpose
  matches.forEach(p => {
    p._score = scorePurpose(p.title, (answers.purpose && answers.purpose.value));
  });

  // Sort by score desc, then price asc (for ties)
  matches.sort((a, b) => (b._score - a._score) || (a.effPrice - b.effPrice));

  // ─── PICK THE TRIO ───
  // Strategy: take the top-K scored candidates, then spread them by price
  // to form a natural "cheaper / our pick / stronger" tier trio.
  //
  // This ensures all three cards are relevant (top-scored) AND feel like
  // a meaningful price spread — rather than picking best-by-score and
  // then scrambling to find anything cheaper/stronger around it.

  const topK = matches.slice(0, Math.min(6, matches.length));
  // Sort top-K by price ascending for tier assignment
  const byPrice = [...topK].sort((a, b) => a.effPrice - b.effPrice);

  let cheaper, best, stronger;

  if (byPrice.length >= 3) {
    // Enough candidates: cheapest = cheaper, middle (by score) = best, priciest = stronger
    cheaper  = byPrice[0];
    stronger = byPrice[byPrice.length - 1];
    // best = highest-scored among the middle slice (excluding cheaper & stronger)
    const middle = byPrice.slice(1, -1);
    middle.sort((a, b) => (b._score - a._score) || (a.effPrice - b.effPrice));
    best = middle[0];
  } else if (byPrice.length === 2) {
    // Two candidates: higher-scored → best, the other → cheaper or stronger by price
    const sorted = [...byPrice].sort((a, b) => (b._score - a._score) || (a.effPrice - b.effPrice));
    best = sorted[0];
    const other = sorted[1];
    if (other.effPrice < best.effPrice)      { cheaper = other; stronger = null; }
    else if (other.effPrice > best.effPrice) { cheaper = null; stronger = other; }
    else                                      { cheaper = null; stronger = null; }
  } else {
    // One candidate: show as best, no cheaper/stronger
    best = byPrice[0];
    cheaper = null;
    stronger = null;
  }

  return {
    best,
    cheaper,
    stronger,
    // Full sorted match set — used by the "see all matching" expandable grid.
    // Pre-sorted by score desc / price asc so the grid order is sensible.
    allMatches: matches.slice(),
    relaxed,
    stats: { strictCount, widenedCount, poolTotal: pool.length }
  };
}

/** After trio is picked, check if the SHOWN products actually match the
 *  requested size. If they do (even though strict-match count was <3),
 *  suppress the "size relaxed" warning — the user got what they wanted. */
function refineRelaxedFlag(result, answers) {
  if (!result || !result.relaxed.sizeRelaxed) return result;
  const sz = (answers.size && answers.size.value);
  if (!sz || sz === 'any') return result;
  const range = SIZE_RANGES[sz];
  const trio = [result.cheaper, result.best, result.stronger].filter(Boolean);
  const matchingSize = trio.filter(p => p.size != null && p.size >= range.min && p.size <= range.max);
  // If every shown product matches the requested size, no need to warn
  if (matchingSize.length === trio.length) {
    result.relaxed.sizeRelaxed = false;
  }
  return result;
}

/** Render final 3 cards */
function renderCards(result, isLive) {
  const grid = document.getElementById('resultCards');

  // Build feature badges row from auto-detected flags — same engine as homepage
  const featBadges = (p) => {
    const out = [];
    if (p.showSale)     out.push(`<span class="rc-badge rc-bd-sale">-${p.saleDiff} lei</span>`);
    if (p.touch)        out.push(`<span class="rc-badge rc-bd-touch">Touch</span>`);
    if (p.gpuDedicated) out.push(`<span class="rc-badge rc-bd-gpu">GPU dedicat</span>`);
    if (p.kbd)          out.push(`<span class="rc-badge rc-bd-kbd">Tast. iluminată</span>`);
    if (p.ramGB >= 16)  out.push(`<span class="rc-badge rc-bd-ram">${p.ramGB}GB RAM</span>`);
    return out.slice(0, 3).join(''); // cap to 3 for clean layout
  };

  const card = (p, tier) => {
    if (!p) {
      return `<div class="rc ${tier.klass}"> <div class="rc-tag">${tier.tag}</div> <div class="rc-empty"> <div class="rc-empty-emoji">🔍</div> <div class="rc-empty-title">Nicio opțiune ${tier.klass === '' && tier.tag === 'Mai ieftin' ? 'mai ieftină' : 'mai puternică'} potrivită</div> <div class="rc-empty-sub">Alegerea noastră e deja cea mai bună aici</div> </div> </div>`;
    }
    const bestBanner = tier.klass === 'best'
      ? `<div class="rc-best-banner">⭐ Recomandat pentru tine</div>`
      : '';
    const badgesHTML = featBadges(p);
    return `<div class="rc ${tier.klass}"> ${bestBanner} <div class="rc-tag">${tier.tag}</div> <div class="rc-img-wrap"> ${p.image ? `<img src="${p.image}" alt="${p.cleanName || ''}" loading="lazy">` : `<svg viewBox="0 0 80 56" width="80" height="56" fill="none"> <rect x="6" y="4" width="68" height="40" rx="4" fill="#E8EEF8" stroke="#C8D4E8" stroke-width="1.5"/> <rect x="10" y="8" width="60" height="32" rx="2" fill="#D0DCEE"/> <rect x="0" y="46" width="80" height="8" rx="2" fill="#D8E4F4"/> </svg>`} </div> ${p.brand ? `<div class="rc-brand">${p.brand}</div>` : ''} <h4>${p.cleanName || p.title || 'Laptop'}</h4> <div class="rc-specs">${p.specs || '&nbsp;'}</div> ${badgesHTML ? `<div class="rc-feat">${badgesHTML}</div>` : ''} <div class="rc-price-wrap"> <div class="rc-price">${fmtPrice(p.effPrice)}</div> ${p.showSale ? `<div class="rc-price-old">${fmtPrice(p.price)}</div>` : ''} </div> <a class="rc-btn" href="${p.link || 'https://www.laptoplab.ro/laptopuri-second-hand'}" ${p.link ? 'target="_blank" rel="noopener"' : ''}> ${tier.klass === 'best' ? 'Vezi detalii →' : 'Vezi detalii'} </a> </div>`;
  };

  grid.innerHTML = [
    card(result.cheaper,  { klass: '',     tag: 'Mai ieftin' }),
    card(result.best,     { klass: 'best', tag: 'Alegerea noastră' }),
    card(result.stronger, { klass: '',     tag: 'Mai puternic' })
  ].join('');

  // ─── Build honest summary that reflects what actually happened ───
  const summary = document.getElementById('matchSummary');
  const heading = document.getElementById('resultHeading');

  if (!isLive) {
    // Feed failed — static selections shown
    summary.innerHTML = 'ℹ️ Nu am putut încărca stocul live — îți arătăm câteva recomandări populare';
    summary.className = 'result-match-summary warn';
    if (heading) heading.textContent = 'Recomandări populare';
    return;
  }

  // isLive === true — we have real data; describe what tier matched
  const r = result.relaxed || {};
  const stats = result.stats || {};

  if (r.noMatchAtAll) {
    // Tier 4 — nothing fit at all, showing from full catalog by purpose score
    summary.innerHTML = `ℹ️ Nu am găsit potriviri exacte, dar iată laptopurile cele mai apropiate de ce ai ales`;
    summary.className = 'result-match-summary warn';
    if (heading) heading.textContent = 'Recomandări apropiate';
  } else if (r.budgetWidened) {
    // Tier 3 — had to widen budget
    summary.innerHTML = `ℹ️ Am extins puțin bugetul ca să găsim potriviri bune (${r.budgetWidened.newLabel})`;
    summary.className = 'result-match-summary warn';
    if (heading) heading.textContent = 'Recomandări apropiate';
  } else if (r.sizeRelaxed) {
    // Tier 2 — size was relaxed (budget still respected)
    summary.innerHTML = `ℹ️ Puține opțiuni la mărimea <strong>${r.sizeRelaxed.originalLabel}</strong> — îți arătăm și alte mărimi potrivite`;
    summary.className = 'result-match-summary warn';
    if (heading) heading.textContent = 'Recomandări apropiate';
  } else {
    // Tier 1 — exact match
    const n = stats.strictCount || 0;
    summary.innerHTML = `✅ ${n} laptopuri găsite în stocul real · potrivire exactă`;
    summary.className = 'result-match-summary good';
    if (heading) heading.textContent = 'Iată laptopurile pentru tine';
  }

  // Set up the smart contextual warning (B1-B4) above the trio
  setupWarning(result, QUIZ.answers, isLive);

  // Set up the "Vezi toate potrivirile" expandable section
  setupAllMatches(result, isLive);

  // Show always-on disclaimer footer (appears after first result render)
  const disc = document.getElementById('quizDisclaimer');
  if (disc) disc.style.display = 'block';
}

/* ══════════════════════════════════════════════════════════════
   SMART CONTEXTUAL WARNING — B-triggers
   ──────────────────────────────────────────────────────────────
   Shows a soft amber callout above the result trio when the user's
   answers + matched product create a likely-mismatch. The warning
   is dismissible per session (sessionStorage) so it doesn't pester
   users on every quiz attempt within the same browsing session.

   Active triggers (in priority order — first match wins):
     B3 — Creative + matched product has <8GB RAM
     B4 — Creative + budget≥800 + matched product has no GPU
     B2 — Creative + 500-800 lei budget
     B1 — Creative + under-500 lei budget
   B3/B4 are the most product-specific so they take priority.
════════════════════════════════════════════════════════════════ */
function setupWarning(result, answers, isLive) {
  const wrap     = document.getElementById('quizWarning');
  const titleEl  = document.getElementById('quizWarningTitle');
  const textEl   = document.getElementById('quizWarningText');
  const closeBtn = document.getElementById('quizWarningClose');
  if (!wrap || !titleEl || !textEl) return;

  // Reset on every render — restart should re-show even if dismissed before
  wrap.style.display = 'none';

  // No warnings on static fallback (we don't have real product data)
  if (!isLive) return;

  // Per-session dismissal: if the user closed the warning earlier in
  // this session for the same key, don't re-show until restart/refresh
  const purpose = (answers.purpose && answers.purpose.value);
  const budget  = (answers.budget && answers.budget.value);
  if (purpose !== 'creative') return; // all triggers are creative-specific

  // The "best" pick is what we evaluate against
  const best = result.best;
  if (!best) return;

  // ── Determine which trigger fires (priority: B3 > B4 > B2 > B1) ──
  let warning = null;

  // B3: Creative + matched product has <8GB RAM
  if (best.ramGB != null && best.ramGB < 8) {
    warning = {
      key: 'B3',
      title: `Atenție: doar ${best.ramGB}GB RAM pentru creație`,
      text: `Pentru Photoshop fluid, editare video sau Premiere recomandăm minim 8GB RAM. Acest laptop are doar ${best.ramGB}GB — bun pentru editare ușoară, limitat pentru proiecte mari.`
    };
  }
  // B4: Creative + budget≥800 + no GPU dedicated
  else if ((budget === '800-1200' || budget === 'over1200') && !best.gpuDedicated) {
    warning = {
      key: 'B4',
      title: 'Grafică integrată — nu GPU dedicat',
      text: 'Acest laptop folosește grafica integrată în procesor — perfect pentru Photoshop și editare foto, dar limitat pentru editare video 4K, 3D sau jocuri noi. La bugetul tău, există opțiuni cu GPU dedicat.'
    };
  }
  // B2: Creative + 500-800 lei
  else if (budget === '500-800') {
    warning = {
      key: 'B2',
      title: 'Buget potrivit pentru creație ușoară',
      text: 'La acest buget, Photoshop și editare foto merg bine. Pentru editare video 4K, jocuri noi sau Premiere Pro, recomandăm peste 1.200 lei. Sună-ne pentru o recomandare personalizată.'
    };
  }
  // B1: Creative + under 500 lei
  else if (budget === 'under500') {
    warning = {
      key: 'B1',
      title: 'Buget limitat pentru creație',
      text: 'Sub 500 lei merge bine pentru muncă de birou și navigare. Pentru Photoshop fluid, editare video sau jocuri, recomandăm un buget de minim 800 lei.'
    };
  }

  if (!warning) return;

  // Check session-dismissal (per warning key — if user dismissed B1, but next
  // run yields B3, we still show the new one)
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem('lab.qWarnDismiss.' + warning.key) === '1';
  } catch (_) { /* sessionStorage may be blocked */ }
  if (dismissed) return;

  // Render
  titleEl.textContent = warning.title;
  textEl.textContent  = warning.text;
  wrap.style.display  = 'flex';

  // Close handler — remember dismissal for this session
  closeBtn.onclick = () => {
    wrap.style.display = 'none';
    try { sessionStorage.setItem('lab.qWarnDismiss.' + warning.key, '1'); } catch (_) {}
  };
}

/* ══════════════════════════════════════════════════════════════
   ALL-MATCHES CTA — toggleable inline grid
   ──────────────────────────────────────────────────────────────
   Shows the user all matched products beyond the trio. Hidden by
   default (button collapsed). Click → grid slides down with cards
   for every match, including the 3 already shown above (greyed
   out with a "Deja afișat sus" pill so they aren't confusing).
════════════════════════════════════════════════════════════════ */
function setupAllMatches(result, isLive) {
  const wrap   = document.getElementById('allMatchesWrap');
  const btn    = document.getElementById('allMatchesBtn');
  const grid   = document.getElementById('allMatchesGrid');
  const lbl    = document.getElementById('allMatchesLabel');
  const sub    = document.getElementById('allMatchesSub');
  const arrow  = document.getElementById('allMatchesArrow');
  if (!wrap || !btn || !grid) return;

  // No "all matches" makes sense for static fallback — hide entirely
  if (!isLive || !result.allMatches || result.allMatches.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  const all      = result.allMatches;
  const totalN   = all.length;
  const trioIds  = new Set([result.cheaper, result.best, result.stronger].filter(Boolean).map(p => p.title));
  const extraN   = all.filter(p => !trioIds.has(p.title)).length;
  const r        = result.relaxed || {};

  // If only 3 or fewer matches AND they're all in the trio, no need for this CTA
  if (extraN === 0 && totalN <= 3) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';

  // Label depends on whether matches are exact or relaxed
  const isExact = !r.noMatchAtAll && !r.budgetWidened && !r.sizeRelaxed;
  if (isExact) {
    lbl.textContent = `Vezi toate cele ${totalN} laptopuri potrivite`;
    sub.textContent = `${extraN} opțiuni în plus față de cele 3 de sus`;
  } else {
    lbl.textContent = `Vezi încă ${extraN} recomandări apropiate`;
    sub.textContent = `Total ${totalN} laptopuri găsite în stoc`;
  }

  // Reset state on each render (in case user restarts quiz)
  btn.classList.remove('expanded');
  grid.style.display = 'none';
  grid.innerHTML = '';
  arrow.textContent = '↓';

  // Toggle handler — render cards on first expand, then just hide/show
  let rendered = false;
  btn.onclick = () => {
    const isOpen = btn.classList.toggle('expanded');
    if (isOpen) {
      if (!rendered) {
        renderAllMatchesGrid(all, trioIds);
        rendered = true;
      }
      grid.style.display = 'grid';
      arrow.textContent = '↑';
      // Smooth scroll the grid into view after the slide animation
      setTimeout(() => grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
    } else {
      grid.style.display = 'none';
      arrow.textContent = '↓';
    }
  };
}

/** Render a single small horizontal card for the all-matches grid */
function renderAllMatchesGrid(all, trioIds) {
  const grid = document.getElementById('allMatchesGrid');
  if (!grid) return;

  // Cap at 12 to keep the page snappy; offer "see all" link beyond that
  const SHOW_MAX = 12;
  const display  = all.slice(0, SHOW_MAX);
  const overflow = all.length - display.length;

  const cardHTML = (p) => {
    const inTrio = trioIds.has(p.title);
    const featBadges = [];
    if (p.touch)        featBadges.push(`<span class="rc-badge rc-bd-touch">Touch</span>`);
    if (p.gpuDedicated) featBadges.push(`<span class="rc-badge rc-bd-gpu">GPU</span>`);
    if (p.kbd)          featBadges.push(`<span class="rc-badge rc-bd-kbd">Tast. ilum.</span>`);
    if (p.ramGB >= 16)  featBadges.push(`<span class="rc-badge rc-bd-ram">${p.ramGB}GB</span>`);
    const featHTML = featBadges.length && !inTrio
      ? `<div class="am-feat">${featBadges.slice(0,3).join('')}</div>`
      : '';

    const thumb = p.image
      ? `<img src="${p.image}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<svg viewBox="0 0 60 42" fill="none"> <rect x="4" y="2" width="52" height="32" rx="3.5" fill="#DFE9F5" stroke="#BCCDE6" stroke-width="1"/> <rect x="0" y="36" width="60" height="5" rx="1.5" fill="#C0D2E8"/> </svg>`;

    const linkAttrs = p.link
      ? `href="${p.link}" target="_blank" rel="noopener"`
      : `href="https://www.laptoplab.ro/laptopuri-second-hand"`;

    return `<a class="am-card ${inTrio ? 'in-trio' : ''}" ${linkAttrs}> <div class="am-thumb">${thumb}</div> <div class="am-body"> ${p.brand ? `<div class="am-brand">${p.brand}</div>` : ''} <div class="am-name">${p.cleanName || p.title || 'Laptop'}</div> <div class="am-spec">${p.specs || ''}</div> ${featHTML} </div> ${inTrio ? '' : ` <div class="am-right"> <div class="am-price">${fmtPrice(p.effPrice)}</div> ${p.showSale ? `<div class="am-price-old">${fmtPrice(p.price)}</div>` : ''} <div class="am-arr">→</div> </div> `} </a>`;
  };

  let html = display.map(cardHTML).join('');

  // Overflow: link to full catalog if too many matches
  if (overflow > 0) {
    html += `<a class="am-see-more" href="https://www.laptoplab.ro/laptopuri-second-hand" target="_blank" rel="noopener"> + încă ${overflow} laptopuri · vezi-le pe toate → </a>`;
  }

  grid.innerHTML = html;
}

/** Static fallback if feed fails — keeps result page functional */
function staticFallback() {
  return {
    cheaper: {
      title: 'HP EliteBook 8470P', brand: 'HP',
      image: 'https://gomagcdn.ro/domains2/laptoplab.ro/files/product/medium/laptop-second-hand-hp-elitebook-8470p-14inch-intel-i5-3380m-4gb-ram-250gb-hdd-windows-10-refurbished-979717.webp',
      link: 'https://www.laptoplab.ro/laptopuri-second-hand',
      effPrice: 549, price: 549, showSale: false, saleDiff: 0,
      touch: false, kbd: false, gpuDedicated: false, ramGB: 4,
      cleanName: 'HP EliteBook 8470P',
      specs: 'i5-3380M · 4GB RAM · 250GB HDD · 14″'
    },
    best: {
      title: 'Lenovo ThinkPad T450s', brand: 'Lenovo',
      image: 'https://gomagcdn.ro/domains2/laptoplab.ro/files/product/medium/laptop-second-hand-lenovo-thinkpad-t450s-14inch-intel-i5-5300u-8gb-ram-windows-10-refurbished-924009.webp',
      link: 'https://www.laptoplab.ro/laptopuri-second-hand',
      effPrice: 699, price: 699, showSale: false, saleDiff: 0,
      touch: false, kbd: true, gpuDedicated: false, ramGB: 8,
      cleanName: 'Lenovo ThinkPad T450s',
      specs: 'i5-5300U · 8GB RAM · 256GB SSD · 14″'
    },
    stronger: {
      title: 'Asus X550LN i7', brand: 'Asus',
      image: 'https://gomagcdn.ro/domains2/laptoplab.ro/files/product/medium/laptop-second-hand-asus-x550ln-15-6inch-intel-i7-4510u-8gb-ram-1000gb-hdd-nvidia-gt-840m-windows-10-refurbished-009459.png',
      link: 'https://www.laptoplab.ro/laptopuri-second-hand',
      effPrice: 899, price: 899, showSale: false, saleDiff: 0,
      touch: false, kbd: false, gpuDedicated: true, ramGB: 12,
      cleanName: 'Asus X550LN i7',
      specs: 'i7-4510U · 12GB RAM · 256GB SSD · NVIDIA'
    }
  };
}

/** Main loader */
async function loadAndMatch() {
  const summary = document.getElementById('matchSummary');
  summary.textContent = '⏳ Căutăm cel mai bun match din stoc…';

  try {
    // Reuse the prefetched feed doc when available — saves a second fetch
    const doc = await getFeedXMLDoc();

    const ns = 'http://base.google.com/ns/1.0';
    const items = Array.from(doc.querySelectorAll('item'))
      .filter(it => {
        var _avEl = it.getElementsByTagNameNS(ns, 'availability')[0]; var av = (_avEl && _avEl.textContent) || '';
        return av.toLowerCase().includes('in_stock') || av.toLowerCase().includes('in stock');
      });

    if (!items.length) throw new Error('no items');

    const pool = items.map(it => buildProduct(it, ns)).filter(p => p.effPrice != null);

    // Update the "all laptops" skip link with the real in-stock count
    const skipCount = document.getElementById('quizSkipCount');
    if (skipCount && pool.length) skipCount.textContent = pool.length;

    const result = pickThree(pool, QUIZ.answers);
    if (result) refineRelaxedFlag(result, QUIZ.answers);

    if (!result) throw new Error('no match');
    renderCards(result, true);
  } catch (err) {
    console.warn('Quiz feed fallback:', err.message);
    renderCards(staticFallback(), false);
  }
}

  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
