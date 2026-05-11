/* ═══════════════════════════════════════════════════════════════════════
   LaptopLab — Homepage JS (path-guarded)
   ──────────────────────────────────────────────────────────────────────
   Loaded from: https://cdn.jsdelivr.net/gh/laptoplabhr/laptoplab-quiz@main/homepage-script.js
   Pasted into:  Gomag homepage HTML section (03-homepage-section.html)
   Wait for: DOMContentLoaded (script tag has `defer`).

   Element guard: only runs if homepage markup is present (#heroCards).
   This way, even if the script is accidentally loaded elsewhere, the
   IIFEs below won't crash on missing DOM nodes.

   Diagnostic console.log markers for debugging:
     [LaptopLab home] script loaded   → JS file IS reaching the page
     [LaptopLab home] not homepage    → loaded but no homepage markup found
     [LaptopLab home] init OK         → all good, page is wired up

   Update workflow:
     1. Edit this file in the GitHub repo (laptoplabhr/laptoplab-quiz)
     2. Commit changes
     3. Bust jsDelivr cache:
        https://purge.jsdelivr.net/gh/laptoplabhr/laptoplab-quiz@main/homepage-script.js
     4. Reload site in incognito to verify
═══════════════════════════════════════════════════════════════════════ */
console.log('[LaptopLab home] script loaded — path:', location.pathname);
(function () {
  'use strict';

  // Element-based guard: presence of #heroCards means we're on the homepage.
  // Path-based guards are brittle (URL could be /, /home, /index, etc).
  if (!document.getElementById('heroCards')) {
    console.log('[LaptopLab home] not homepage — skipping init');
    return;
  }
  console.log('[LaptopLab home] init OK');

'use strict';


/* Scroll reveal */
const ro = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => ro.observe(el));

/* Hero rating strip fade-in */
const rs = document.getElementById('ratingStrip');
if (rs) setTimeout(() => rs.classList.add('visible'), 800);

/* Trust bar stagger */
const trustObs = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) {
    document.querySelectorAll('.trust-item').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 90);
    });
    trustObs.disconnect();
  }
}, { threshold: 0.2 });
const tb = document.getElementById('trustBar');
if (tb) trustObs.observe(tb);

/* Counter animation */
function runCount(el) {
  const target = +el.dataset.to;
  const dur = 1300;
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const ease = p < .5 ? 2*p*p : -1+(4-2*p)*p;
    el.textContent = Math.round(ease * target);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
const cntObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.querySelectorAll('.cnt').forEach(runCount);
      cntObs.unobserve(e.target);
    }
  });
}, { threshold: 0.25 });
['heroKpis','whyStats'].forEach(id => {
  const el = document.getElementById(id);
  if (el) cntObs.observe(el);
});

/* ══════════════════════════════════════════════════════════════
   LaptopLab — UNIFIED LIVE PRODUCT ENGINE
   ──────────────────────────────────────────────────────────────
   One feed fetch. One cache. One extraction engine.
   Used by:  • Hero cards (top 3 picks)
             • Main grid (8 featured)
             • Quiz page (all matching)   ← shared via window.LaptopLab
   ──────────────────────────────────────────────────────────────
   Zero hardcoding. Labels (Touch, GPU Dedicat, Tastatură
   iluminată, RAM, condition, Sale) are all auto-detected from
   the Google Shopping XML <title>, <price>/<sale_price>,
   <condition>, <availability>, <image_link>, <link>, <brand>.
════════════════════════════════════════════════════════════════ */
(function () {
  const FEED_URL = 'https://www.laptoplab.ro/feed/googleShoppingAds.xml';
  const NS       = 'http://base.google.com/ns/1.0';

  // ─── Single shared promise — fetches feed once per page load ───
  let feedPromise = null;
  function getFeed() {
    if (feedPromise) return feedPromise;
    feedPromise = fetch(FEED_URL)
      .then(r => { if (!r.ok) throw new Error('feed http ' + r.status); return r.text(); })
      .then(xml => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('feed parse error');
        const items = Array.from(doc.querySelectorAll('item'));
        return items.map(parseItem).filter(p => p.effPrice != null);
      });
    return feedPromise;
  }

  // ─── XML helpers ───
  const g  = (it, f) => it.getElementsByTagNameNS(NS, f)[0]?.textContent?.trim() || '';
  const tx = (it, f) => it.querySelector(f)?.textContent?.trim() || '';

  // ─── Price parsing ("1299.00 RON" → 1299) ───
  function parsePrice(s) {
    if (!s) return null;
    const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }
  function fmtPrice(n) {
    if (n == null) return '';
    return Math.round(n).toLocaleString('ro-RO') + ' lei';
  }

  // ─── Title cleaners ───
  // Strip prefix + brand + tail noise. Used for spec rows and tooltips
  // where we want the descriptive title minus the boilerplate.
  function cleanTitle(title, brand) {
    let t = title || '';
    t = t.replace(/^Laptop\s+(Second\s*Hand|Refurbished)\s+/i, '');
    if (brand) t = t.replace(new RegExp('^' + brand + '[\\s\\-–]?', 'i'), '');
    t = t.replace(/\s+Refurbished\s*$/i, '');
    t = t.replace(/\s+Windows\s+\d+\s*$/i, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  // Card-display name — JUST the model identifier, nothing else.
  // Strategy: take cleanTitle output, then cut at the first screen-size
  // marker (15.6inch, 14", 13.3 inch, etc). Everything after the screen
  // size is specs that already appear in the spec row below the title,
  // so repeating them in the title creates visual noise.
  //
  // Examples:
  //   "V110-15ISK - 15.6inch FHD Intel I5-7200U..."  →  "V110-15ISK"
  //   "MacBook Pro A1706 13.3inch QHD i5-6267U..."   →  "MacBook Pro A1706"
  //   "Latitude 5590"                                →  "Latitude 5590"  (no size, kept as-is)
  //   "ThinkPad T440s TOUCH 14inch i7-4600U..."      →  "ThinkPad T440s TOUCH"
  function shortName(title, brand) {
    let t = cleanTitle(title, brand);
    // Cut at the first screen-size marker.
    const sizeRe = /\s*[-–—]?\s*\d{2}(?:\.\d)?\s*(?:inch|"|″|in\b)/i;
    const m = t.match(sizeRe);
    if (m) t = t.substring(0, m.index);
    // Trim trailing dashes/spaces left over from the cut
    t = t.replace(/[\s\-–—]+$/, '').trim();
    // Safety cap
    if (t.length > 50) t = t.slice(0, 47) + '…';
    return t;
  }

  // ─── ATTRIBUTE EXTRACTION — all from title text ───
  // Returns: { cpu, ram, storage, screen, os, touch, kbd, gpuDedicated, gpuName, condition }
  function extractAttrs(title, conditionField) {
    const t = title || '';

    // CPU — i3/i5/i7/i9 with model, or Ryzen, Celeron, Pentium, Apple Mx
    const cpuM = t.match(/\b(i[3579][\s-]?\d{3,4}\w*)\b/i)
               || t.match(/\b(Ryzen\s*\d+[\s\w-]*?\d{3,4}\w*)\b/i)
               || t.match(/\b(Celeron\s+\w+)/i)
               || t.match(/\b(Pentium\s+\w+)/i)
               || t.match(/\b(M[123]\s*(?:Pro|Max|Ultra)?)\b/i);
    const cpu = cpuM ? cpuM[1].replace(/\s+/g, '-').replace(/--+/g, '-') : '';

    // RAM — "8GB RAM" or just "8GB" near RAM keyword
    const ramM = t.match(/(\d{1,2})\s*GB\s*RAM/i) || t.match(/\b(\d{1,2})\s*GB\b(?!\s*(SSD|HDD))/i);
    const ramGB = ramM ? parseInt(ramM[1], 10) : null;
    const ram = ramGB ? ramGB + 'GB RAM' : '';

    // Storage — SSD preferred, fallback HDD
    const ssdM = t.match(/(\d{2,4})\s*GB\s*SSD/i);
    const hddM = t.match(/(\d{2,4})\s*GB\s*HDD/i);
    const storage = ssdM ? ssdM[1] + 'GB SSD'
                  : hddM ? hddM[1] + 'GB HDD' : '';

    // Screen size — 14inch, 15.6", 13.3inch, 14 inch
    const scrM = t.match(/(\d{2}(?:\.\d)?)\s*(?:inch|"|″|in\b)/i);
    const screen = scrM ? scrM[1] + '″' : '';
    const screenSize = scrM ? parseFloat(scrM[1]) : null;

    // OS
    const osM = t.match(/\bWindows\s+(\d+)\b/i);
    const os = osM ? 'Win ' + osM[1]
             : /macOS|OS\s*X/i.test(t) ? 'macOS' : '';

    // Screen resolution — checked high-to-low to avoid HD matching FHD.
    //   4K       → "3840x2160", "4K", "UHD"
    //   QHD/2K   → "2560x1440", "QHD", "WQHD", "2K"
    //   Retina   → "Retina" (Apple-only label)
    //   FHD      → "1920x1080", "FHD", "Full HD"
    //   HD+      → "1600x900", "HD+"
    //   HD       → "1366x768", "HD" (only if not already FHD)
    let resolution = '';
    if      (/\b3840\s*[x×]\s*2160\b|\b4K\b|\bUHD\b/i.test(t))                 resolution = '4K';
    else if (/\b2560\s*[x×]\s*1440\b|\bQHD\b|\bWQHD\b|\b2K\b/i.test(t))        resolution = 'QHD';
    else if (/\bRetina\b/i.test(t))                                            resolution = 'Retina';
    else if (/\b1920\s*[x×]\s*1080\b|\bFHD\b|\bFull\s*HD\b/i.test(t))          resolution = 'FHD';
    else if (/\b1600\s*[x×]\s*900\b|\bHD\+/i.test(t))                          resolution = 'HD+';
    else if (/\b1366\s*[x×]\s*768\b|\bHD\b/i.test(t))                          resolution = 'HD';

    // TOUCH — appears uppercase in titles (e.g. "X1 Yoga Gen2 TOUCH")
    const touch = /\bTOUCH\b/i.test(t);

    // Illuminated keyboard — "TAST. ILUM.", "Tastatură iluminată", "Backlit KB"
    const kbd = /\bTAST\.?\s*ILUM/i.test(t)
             || /\btastatur[aă]\s+ilumin/i.test(t)
             || /\bbacklit(\s+kb|\s+keyboard)?\b/i.test(t);

    // GPU — Dedicated GPU detection
    //   NVIDIA: nvidia, geforce, gtx, rtx, quadro, mx[0-9]{3}
    //   AMD:    radeon, rx[\s]?[0-9]{3,4}, amd\s+(radeon|firepro),  ATI, Firepro
    //   Intel Iris/Xe NOT treated as dedicated (integrated)
    const gpuDed = /\b(nvidia|geforce|gtx|rtx|quadro|mx\s*\d{3})\b/i.test(t)
                || /\b(radeon|ati\s+radeon|firepro|rx\s*\d{3,4})\b/i.test(t)
                || /\bamd\s+(radeon|r[579]|hd\s*\d{4}|firepro)\b/i.test(t);
    // Try to get specific GPU model name for tooltip/label
    let gpuName = '';
    const gpuM = t.match(/\b(NVIDIA\s*\w*\s*\w*|GeForce\s*\w*\s*\w*|GTX\s*\d{3,4}\w*|RTX\s*\d{3,4}\w*|Quadro\s*\w*|Radeon\s*\w*\s*\d*\w*|MX\s*\d{3,4}|FirePro\s*\w*)/i);
    if (gpuM) gpuName = gpuM[1].replace(/\s+/g, ' ').trim();

    // Condition — prefer feed field, fall back to title
    let condition = (conditionField || '').toLowerCase();
    if (!condition) {
      if (/\brefurbished\b/i.test(t)) condition = 'refurbished';
      else if (/\bsecond[\s-]?hand\b/i.test(t)) condition = 'used';
      else if (/\bnou\b/i.test(t)) condition = 'new';
    }

    return { cpu, ram, ramGB, storage, screen, screenSize, os, resolution, touch, kbd, gpuDedicated: gpuDed, gpuName, condition };
  }

  // ─── Build a product object from <item> ───
  function parseItem(item) {
    const title     = g(item, 'title') || tx(item, 'title');
    const price     = parsePrice(g(item, 'price'));
    const salePrice = parsePrice(g(item, 'sale_price'));
    const effPrice  = salePrice && salePrice < price ? salePrice : price;
    const image     = g(item, 'image_link');
    const link      = g(item, 'link') || tx(item, 'link');
    const brand     = g(item, 'brand');
    const condField = g(item, 'condition');
    const avail     = g(item, 'availability');
    const inStock   = /in[\s_]?stock/i.test(avail);

    const attrs = extractAttrs(title, condField);

    return {
      raw: { title, brand, condField, avail },
      title, brand, image, link, avail, inStock,
      price, salePrice, effPrice,
      showSale: salePrice != null && price != null && salePrice < price,
      saleDiff: (price != null && salePrice != null) ? Math.round(price - salePrice) : 0,
      attrs,
      // flat convenience
      cpu: attrs.cpu, ram: attrs.ram, ramGB: attrs.ramGB, storage: attrs.storage,
      screen: attrs.screen, screenSize: attrs.screenSize, os: attrs.os, resolution: attrs.resolution,
      touch: attrs.touch, kbd: attrs.kbd,
      gpuDedicated: attrs.gpuDedicated, gpuName: attrs.gpuName,
      condition: attrs.condition,
      cleanName: shortName(title, brand)
    };
  }

  // ─── Helpers to build badge HTML (auto from attrs) ───
  function buildBadges(p, opts = {}) {
    const out = [];
    if (opts.popularFirst) out.push(`<span class="badge badge-pop">⭐ Cel mai popular</span>`);
    if (p.showSale)        out.push(`<span class="badge badge-sale">-${p.saleDiff} lei</span>`);
    if (p.touch)           out.push(`<span class="badge badge-touch">Touch</span>`);
    if (p.gpuDedicated)    out.push(`<span class="badge badge-gpu">GPU dedicat</span>`);
    if (p.kbd)             out.push(`<span class="badge badge-kbd">Tast. iluminată</span>`);
    if (p.ramGB >= 16 && !opts.popularFirst) out.push(`<span class="badge badge-ram">${p.ramGB}GB RAM</span>`);
    if (p.condition === 'new') out.push(`<span class="badge badge-new">Nou</span>`);
    return out.slice(0, opts.limit || 3).join(''); // cap visible badges so layout stays clean
  }

  // ─── Spec string for hero/side cards ───
  function buildSpec(p) {
    // Format: "i5-5300U · 8GB RAM · 256GB SSD · 14″ FHD · Win 10"
    // Screen + resolution are combined into one bit so they read as a unit.
    const screenBit = p.screen
      ? (p.resolution ? p.screen + ' ' + p.resolution : p.screen)
      : '';
    const bits = [p.cpu, p.ram, p.storage, screenBit, p.os].filter(Boolean);
    return bits.join(' · ');
  }

  // ─── Spec string for grid cards (more compact) ───
  // Same format as hero — consistency across the site, and the OS +
  // resolution are universally useful pieces of info that buyers scan for.
  function buildSpecCompact(p) {
    const screenBit = p.screen
      ? (p.resolution ? p.screen + ' ' + p.resolution : p.screen)
      : '';
    const bits = [p.cpu, p.ram, p.storage, screenBit, p.os].filter(Boolean);
    return bits.join(' · ');
  }

  // ─── Render HERO CARDS (3 picks — featured, interesting, deal) ───
  function renderHeroCards(products) {
    const wrap = document.getElementById('heroCards');
    if (!wrap) return;

    const inStock = products.filter(p => p.inStock);
    if (inStock.length < 1) {
      renderHeroError();
      return;
    }

    // Pick smart trio:
    //   1. FEATURED  — a TOUCH or high-RAM model (wow factor)
    //   2. INTEREST  — dedicated GPU if any, else 16GB+ RAM, else second random
    //   3. DEAL      — product with best sale (largest diff), else newest
    const byInterest = [...inStock];

    const touchFirst = byInterest.find(p => p.touch);
    const gpuPick    = byInterest.find(p => p.gpuDedicated);
    const ramPick    = byInterest.find(p => (p.ramGB || 0) >= 16);
    const salePick   = [...byInterest].sort((a, b) => (b.showSale ? b.saleDiff : 0) - (a.showSale ? a.saleDiff : 0))[0];

    // Rotate logic to avoid duplicates
    const picks = [];
    const push = (p) => { if (p && !picks.includes(p) && picks.length < 3) picks.push(p); };
    push(touchFirst || byInterest[0]);
    push(gpuPick || ramPick || byInterest[1]);
    push(salePick && salePick.showSale ? salePick : byInterest[2] || byInterest[1]);

    // Fill any empty slots with remaining in-stock products
    for (const p of inStock) push(p);
    const finalPicks = picks.slice(0, 3);
    if (finalPicks.length < 1) { renderHeroError(); return; }

    const ratingStripHTML = document.getElementById('ratingStrip')?.outerHTML || '';
    wrap.innerHTML = finalPicks.map((p, i) =>
      renderHeroCard(p, { featured: i === 0 })
    ).join('') + ratingStripHTML;

    // Stagger animate them in
    wrap.querySelectorAll('.hcard').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), 100 + i * 140);
    });
  }

  function renderHeroCard(p, { featured }) {
    const badges = buildBadges(p, { popularFirst: featured, limit: 2 });
    const oldPrice = p.showSale
      ? `<div class="hcard-old">${fmtPrice(p.price)}</div>`
      : '';

    const thumb = p.image
      ? `<img src="${p.image}" alt="${escapeAttr(p.cleanName)}" loading="lazy">`
      : `<svg viewBox="0 0 60 42" fill="none">
          <rect x="4" y="2" width="52" height="32" rx="3.5" fill="#DFE9F5" stroke="#BCCDE6" stroke-width="1"/>
          <rect x="7" y="5" width="46" height="26" rx="2" fill="#152340"/>
          <rect x="0" y="36" width="60" height="5" rx="1.5" fill="#C0D2E8" stroke="#AAC0DA" stroke-width=".8"/>
          <rect x="22" y="41" width="16" height="2.5" rx="1" fill="#AAC0DA"/>
        </svg>`;

    return `
      <a class="hcard ${featured ? 'featured' : ''}" href="${p.link || 'https://www.laptoplab.ro/laptopuri-second-hand'}" ${p.link ? 'target="_blank" rel="noopener"' : ''}>
        <div class="hcard-thumb">${thumb}</div>
        <div class="hcard-body">
          ${badges ? `<div class="hcard-badges">${badges}</div>` : ''}
          ${p.brand ? `<div class="hcard-brand">${p.brand}</div>` : ''}
          <div class="hcard-name">${escapeHTML(p.cleanName)}</div>
          <div class="hcard-spec">${buildSpec(p)}</div>
        </div>
        <div class="hcard-right">
          <div class="hcard-price">${fmtPrice(p.effPrice)}</div>
          ${oldPrice}
          <div class="hcard-arr">→</div>
        </div>
      </a>`;
  }

  function renderHeroError() {
    const wrap = document.getElementById('heroCards');
    if (!wrap) return;
    const ratingStripHTML = document.getElementById('ratingStrip')?.outerHTML || '';
    wrap.innerHTML = `
      <div class="hcard-error">
        Stocul se încarcă acum. <a href="https://www.laptoplab.ro/laptopuri-second-hand">Vezi toate laptopurile →</a>
      </div>` + ratingStripHTML;
  }

  // ─── Render MAIN GRID (8 cards in products section) ───
  function renderMainGrid(products) {
    const grid = document.getElementById('prodGrid');
    const skel = document.getElementById('prodSkeleton');
    const seeAll = document.getElementById('prodSeeAll');
    if (!grid) return;

    const inStock = products.filter(p => p.inStock).slice(0, 8);
    if (!inStock.length) {
      document.getElementById('prodError').style.display = 'block';
      if (skel) skel.style.display = 'none';
      return;
    }

    grid.innerHTML = inStock.map(p => renderGridCard(p)).join('');
    if (skel) skel.style.display = 'none';
    grid.style.display = 'grid';
    if (seeAll) seeAll.style.display = 'flex';
  }

  function renderGridCard(p) {
    // Main-grid badges go on the IMAGE (top-left).
    // We DO NOT badge "Refurbished" or "Second Hand" since every laptop in
    // our stock is one or the other — showing it on every card is noise.
    // Only show condition when it's "Nou" (rare and meaningful), or when
    // there's an active sale.
    const condLabel = p.condition === 'new' ? 'Nou' : '';

    // Feature badges (touch, gpu, kbd) go INSIDE the info area, below title
    const featBadges = [];
    if (p.touch)        featBadges.push(`<span class="badge badge-touch">Touch</span>`);
    if (p.gpuDedicated) featBadges.push(`<span class="badge badge-gpu">GPU dedicat</span>`);
    if (p.kbd)          featBadges.push(`<span class="badge badge-kbd">Tast. iluminată</span>`);
    if (p.ramGB >= 16)  featBadges.push(`<span class="badge badge-ram">${p.ramGB}GB RAM</span>`);
    const featHTML = featBadges.length ? `<div class="prod-feat">${featBadges.slice(0,3).join('')}</div>` : '';

    const fallbackSVG = `<svg class="prod-img-fallback" viewBox="0 0 80 56" fill="none">
      <rect x="6" y="4" width="68" height="40" rx="4" fill="#E8EEF8" stroke="#C8D4E8" stroke-width="1.5"/>
      <rect x="10" y="8" width="60" height="32" rx="2" fill="#D0DCEE"/>
      <rect x="0" y="46" width="80" height="8" rx="2" fill="#D8E4F4"/>
    </svg>`;

    const imgTag = p.image
      ? `<img src="${p.image}" alt="${escapeAttr(p.cleanName)}" loading="lazy" onerror="this.style.display='none'">`
      : fallbackSVG;

    return `
      <a class="prod-card" href="${p.link}" target="_blank" rel="noopener">
        <div class="prod-img-wrap">
          ${imgTag}
          <div class="prod-badge-wrap">
            ${condLabel ? `<span class="prod-badge pb-new">${condLabel}</span>` : ''}
            ${p.showSale ? `<span class="prod-badge pb-sale">-${p.saleDiff} lei</span>` : ''}
          </div>
          <div class="prod-fav">♡</div>
        </div>
        <div class="prod-info">
          ${p.brand ? `<div class="prod-brand">${p.brand}</div>` : ''}
          <div class="prod-name">${escapeHTML(p.cleanName)}</div>
          <div class="prod-spec">${buildSpecCompact(p)}</div>
          ${featHTML}
          <div class="prod-footer">
            <div class="prod-price-wrap">
              <div class="prod-price">${fmtPrice(p.effPrice)}</div>
              ${p.showSale ? `<div class="prod-price-old">${fmtPrice(p.price)}</div>` : ''}
            </div>
            <div class="prod-btn">→</div>
          </div>
        </div>
      </a>`;
  }

  // ─── HTML escape helpers (safety against odd chars in titles) ───
  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
  }
  function escapeAttr(s) { return escapeHTML(s); }

  // ─── Expose for quiz page & debugging ───
  // window.LaptopLab.version is bumped when extraction logic changes
  // substantively. Check it in the browser console to confirm which
  // version is loaded after a deploy.
  window.LaptopLab = {
    version: '2.3',  // 2.3 = real PNG brand logos, full-bleed quiz teaser, laptop scene centered
    FEED_URL,
    getFeed,
    parseItem,
    extractAttrs,
    fmtPrice,
    cleanTitle,
    shortName,
    buildBadges,
    buildSpec,
    buildSpecCompact
  };

  // ─── Update all "in stock" counters across the page from live feed ───
  // Replaces hardcoded "111" / "500+" with the actual in-stock count.
  // Called once after the feed loads. The pre-feed placeholder ("100+") is
  // replaced with the real number; if KPI counters had already animated to
  // the placeholder, they'll re-animate to the new value smoothly.
  function updateStockCount(products) {
    const inStockCount = products.filter(p => p.inStock).length;
    if (inStockCount < 1) return; // safety: feed gave nothing usable

    // 1. Hero eyebrow text
    const heroLine = document.getElementById('heroStockCount');
    if (heroLine) heroLine.textContent = inStockCount;

    // 2. Hero KPI "Laptopuri disponibile" — re-run counter to match live value
    const heroKpi = document.getElementById('heroKpiStock');
    if (heroKpi) {
      heroKpi.dataset.to = inStockCount;
      // If already animated (counter visible), tween to new value;
      // else IntersectionObserver below will pick up the new data-to
      const current = parseInt(heroKpi.textContent, 10) || 0;
      if (current > 0 && current !== inStockCount) {
        heroKpi.textContent = inStockCount;
      }
    }

    // 3. Why-us section "Produse" counter
    const whyKpi = document.getElementById('whyStatsStock');
    if (whyKpi) {
      whyKpi.dataset.to = inStockCount;
      const current = parseInt(whyKpi.textContent, 10) || 0;
      if (current > 0 && current !== inStockCount) {
        whyKpi.textContent = inStockCount;
      }
    }
  }

  // ─── BOOT — run both renders in parallel on single fetch ───
  getFeed()
    .then(products => {
      updateStockCount(products);
      renderHeroCards(products);
      renderMainGrid(products);
    })
    .catch(err => {
      console.warn('LaptopLab feed:', err.message);
      renderHeroError();
      const skel = document.getElementById('prodSkeleton');
      if (skel) skel.style.display = 'none';
      const prodErr = document.getElementById('prodError');
      if (prodErr) prodErr.style.display = 'block';
    });

  // Show extra grid skeleton cards on wider screens (preserved)
  if (window.innerWidth >= 640) {
    ['sk3','sk4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }
})();

/* ══════════════════════════════════════════════════════════════
   Reviews are hardcoded above as static cards (real Google reviews).
   The Google rating badge shows a fixed score — update manually if
   your rating ever changes meaningfully. No API call on page load.
══════════════════════════════════════════════════════════════ */
(function initRatingBadge() {
  const gCount = document.getElementById('gCount');
  if (gCount && !gCount.textContent.includes('recenzii')) {
    gCount.textContent = '· recenzii Google';
  }
})();


})(); // end of homepage path-guard wrapper
