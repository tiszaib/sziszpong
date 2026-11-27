// SZISZpong · Bajnokság fül nézetei: üres állapot, kiáltvány, sorsolás, Lánchíd-ágrajz, bajnok, Arcképcsarnok, Hírlap, Szabályok
// A kupa adatai az adatbázisból jönnek (004_bajnoksag.sql); a szabályokat (sorsolás, továbbjutás) is az adatbázis dönti el.
// Ez a fájl csak a Bajnokság fül megnyitásakor töltődik le.
import { $app, $modal, busy, esc, modal, nameOf, playerById, rpc, state, toast } from './core.js';
import { EMPTY_ART, artFor } from './arena.js';
import { loadArchive, loadTour, shownCup } from './tournament.js';

const DAY = 86400000;
// T: az éppen mutatott kupa a nézetek számára (a rajzolók ezt olvassák)
export const T = {
  id: null,
  status: 'none',      // none | reg | running | done
  size: 8, bronze: true, msg: '', by: null, deadline: 0, hours: 24,
  entries: [],         // játékos id-k a jelentkezés sorrendjében
  games: [],           // { r, i, a, b, w, sa, sb, wo, ready }  r: forduló (0 = első), i: sorszám; bronz: r = -1
  champion: null, finishedAt: 0,
};
// az adatbázis szerinti kupa átírása a T-be
function syncT() {
  const c = shownCup();
  Object.assign(T, c ? {
    id: c.id, status: c.status, size: c.size, bronze: c.bronze, msg: c.msg || '', by: c.by, deadline: Date.parse(c.until), hours: c.hours || 24,
    entries: c.entries.map((e) => e.p), games: c.games.map((g) => ({ ...g })), champion: c.champion, finishedAt: c.finished ? Date.parse(c.finished) : 0,
  } : { id: null, status: 'none', entries: [], games: [], champion: null, finishedAt: 0 });
}
// a lezárt kupák egységes alakban (Hírlap, Csarnok, Kupavadászok)
const cupOf = (c) => ({
  id: c.id, at: c.finished, size: c.size, bronze: c.bronze, by: c.by, entries: c.entries.map((e) => e.p),
  elo: Object.fromEntries(c.entries.map((e) => [e.p, e.elo])), games: c.games, champion: c.champion,
});
const archive = () => state.tour.archive.map(cupOf);
const HALL = () => archive().map((c) => ({ id: c.id, name: nameOf(c.champion), at: c.at, size: c.size }));

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
const romanDate = (d) => { d = new Date(d); return `${roman(d.getFullYear())}. ${roman(d.getMonth() + 1)}. ${d.getDate()}.`; };
const rounds = () => Math.log2(T.size);
const roundName = (r) => { const k = rounds() - 1 - r; return k === 0 ? 'Döntő' : k === 1 ? 'Elődöntő' : k === 2 ? 'Negyeddöntő' : `${roman(r + 1)}. forduló`; };
const nm = (id, g) => (id ? esc(nameOf(id)) : g && g.r === 0 ? '<i>erőnyerő</i>' : '<i>?</i>');
const me = () => state.me?.id;
const isBoss = () => !!state.me && (state.me.is_admin || T.by === me());
const gameAt = (r, i) => T.games.find((g) => g.r === r && g.i === i);
const order = (x, y) => (x.r === -1) - (y.r === -1) || x.r - y.r || x.i - y.i;
// a következő meccs: ha nekem van esedékes meccsem, az; különben a legkorábbi
const nextGame = () => {
  const open = T.games.filter((g) => g.a && g.b && !g.w).sort(order);
  return open.find((g) => g.a === me() || g.b === me()) || open[0];
};
const isFinal = (g) => g.r === rounds() - 1;
const left = (d) => { const ms = Math.max(0, d - Date.now()); const h = Math.floor(ms / 3600000); return h >= 24 ? `${Math.floor(h / 24)} nap ${h % 24} ó` : `${h} ó ${Math.floor((ms % 3600000) / 60000)} p`; };
const overdue = (g) => g.ready && Date.now() - Date.parse(g.ready) > T.hours * 3600000;

/* ---------------- közös elemek ---------------- */
const head = (title, sub) => `
  <header class="ar-head">
    <div class="ar-orn" aria-hidden="true"><i></i>✦<i></i></div>
    <h1 class="ar-title">${title}</h1>
    ${sub ? `<p class="ar-sub">${sub}</p>` : ''}
  </header>`;
const orn = '<div class="ar-orn small" aria-hidden="true"><i></i>❦<i></i></div>';
const ALT = { none: 'Széchenyi István sportruhában egy nagy képkeretnek támaszkodik', reg: 'Széchenyi az ütőjével a keretre mutat, toboroz',
  running: 'Széchenyi István pingpongozik', done: 'Széchenyi a magasba emeli a kupát' };
function szechenyi(text, key = 'none', cls = '') {
  const a = artFor(key); const s = a.sign; const k = a === artFor('none') ? 'none' : key;
  const vars = s ? `;--sx:${s.x}%;--sy:${s.y}%;--sw:${s.w}%;--sh:${s.h}%;--sr:${s.rot}deg;--fs:${s.size}cqw` : '';
  return `
    <figure class="ar-stage ${cls}">
      <div class="ar-canvas" style="aspect-ratio:${a.ratio}${vars}">
        <img src="${a.src}" alt="${ALT[k]}" decoding="async">
        ${s && text ? `<div class="ar-sign"><span>${text}</span></div>` : ''}
      </div>
    </figure>`;
}

/* ---------------- nézetek ---------------- */
export function arenaView(sub) {
  syncT();
  if (sub === 'csarnok') return hallView();
  if (sub === 'hirlap') return heraldView();
  if (sub === 'szabalyok') return rulesView();
  if (T.status === 'reg') return procView();
  if (T.status === 'running') return bracketView();
  if (T.status === 'done') return championView();
  return emptyView();
}

function emptyView() {
  const l = state.tour.last; const last = l && { name: nameOf(l.champion), at: l.at };
  return `
    <section class="ar">
      ${head('Bajnokság', 'A KGY-terem nagy tornái')}
      ${szechenyi(EMPTY_ART.text)}
      <div class="ar-cta">
        <button type="button" class="btn block ar-gold" data-ar-new>⚔️ Indíts Lánchíd Kupát</button>
        <button type="button" class="btn block ar-ghost" data-ar-special>✉️ Egyedi bajnokság? Beszélj Balázzsal</button>
      </div>
      ${last ? `<a class="ar-last" href="#/bajnoksag/csarnok"><span class="ar-last-ic">🏆</span><span><small>Legutóbbi bajnok</small><b>${esc(last.name)}</b><em>Lánchíd Kupa · ${romanDate(last.at)}</em></span><span class="ar-last-go">›</span></a>` : ''}
      ${orn}
    </section>`;
}

function procView() {
  const mine = T.entries.includes(me()); const full = T.entries.length >= T.size;
  const slots = Array.from({ length: T.size }, (_, i) => T.entries[i]);
  return `
    <section class="ar">
      ${head('Lánchíd Kupa', 'Kiáltvány')}
      ${szechenyi(full ? 'Betelt!' : `Még<b class="sg-n">${T.size - T.entries.length}</b>szabad<br>hely`, 'reg', 'small')}
      <div class="proc">
        <div class="proc-top">KIÁLTVÁNY</div>
        <p class="proc-lead">Lánchíd Kupát hirdet <b>${esc(nameOf(T.by))}</b>.<br>${T.size} hely · egyenes kieséses${T.bronze ? ' · bronzmeccs' : ''} · a döntő 2x pontot ér</p>
        ${T.msg ? `<p class="proc-msg">„${esc(T.msg)}”</p>` : ''}
        <div class="proc-dl">Jelentkezés még <b class="proc-left">${left(T.deadline)}</b></div>
        ${COIN_DEFS}
        <div class="proc-slots s${T.size}">
          ${slots.map((id, i) => coin(id, i)).join('')}
        </div>
        <div class="proc-count">${T.entries.length} / ${T.size} jelentkező</div>
        <div class="seal" aria-hidden="true"><span>SZ</span></div>
      </div>
      <div class="ar-cta">
        ${mine ? '<button type="button" class="btn block ar-ghost" data-ar-leave>Visszalépek</button>'
          : `<button type="button" class="btn block ar-gold" data-ar-join ${full ? 'disabled' : ''}>✍️ Jelentkezem</button>`}
        ${isBoss() ? `<button type="button" class="btn block ar-ghost" data-ar-draw ${T.entries.length < 4 ? 'disabled' : ''}>🎭 Sorsolás most${T.entries.length < 4 ? '<small>legalább 4 nevező kell</small>' : ''}</button>
          <button type="button" class="ar-link" data-ar-cancel>A kiírás visszavonása</button>` : ''}
      </div>
      ${orn}
    </section>`;
}

/* ---------------- aranyérme (kiáltvány) ---------------- */
// egy közös érme-rajz: recés szél, dombornyomott babérkoszorú, fényes mező; minden hely ezt használja
const COIN_DEFS = (() => {
  let leaves = '';
  for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {
    const deg = 90 + s * (22 + k * 16); const a = deg * Math.PI / 180;
    const x = 50 + 40 * Math.cos(a); const y = 50 + 40 * Math.sin(a);
    leaves += `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="3.4" ry="1.35" transform="rotate(${(deg + 90 + s * 28).toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"/>`;
  }
  return `<svg class="coin-defs" width="0" height="0" aria-hidden="true"><defs>
    <radialGradient id="cn-rim" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#e2bd55"/><stop offset=".85" stop-color="#a3792a"/><stop offset="1" stop-color="#6e4c12"/></radialGradient>
    <radialGradient id="cn-field" cx=".4" cy=".32" r=".75"><stop offset="0" stop-color="#fcebb0"/><stop offset=".55" stop-color="#dcb24c"/><stop offset="1" stop-color="#a77d2c"/></radialGradient>
    <symbol id="coin-face" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="49" fill="#6e4c12"/>
      <circle cx="50" cy="50" r="47.6" fill="none" stroke="#f6dd8c" stroke-width="2.6" stroke-dasharray="1 1.15" opacity=".85"/>
      <circle cx="50" cy="50" r="45.6" fill="url(#cn-rim)"/>
      <circle cx="50" cy="50" r="45.6" fill="none" stroke="#5a3d0c" stroke-width=".8"/>
      <g fill="#8a6418" opacity=".9" transform="translate(.5 .7)">${leaves}</g>
      <g fill="#fbe7a6">${leaves}</g>
      <path d="M50 6.6l1.3 3 3.2.2-2.5 2 .8 3.1L50 13.2l-2.8 1.7.8-3.1-2.5-2 3.2-.2z" fill="#fbe7a6" stroke="#8a6418" stroke-width=".4"/>
      <circle cx="50" cy="50" r="34.5" fill="url(#cn-field)"/>
      <circle cx="50" cy="50" r="34.5" fill="none" stroke="#6e4c12" stroke-width="1.1"/>
      <circle cx="50" cy="50" r="33" fill="none" stroke="#fff3c4" stroke-width=".7" opacity=".7"/>
    </symbol></defs></svg>`;
})();
function coin(id, i) {
  const n = id ? nameOf(id) : '';
  const fs = n.length > 8 ? 12 : n.length > 6 ? 13.5 : 15.5;
  return `<div class="coin ${id ? 'on' : ''}" data-slot="${i}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><use href="#coin-face"/></svg>
    <span class="coin-name" style="font-size:${fs}px">${id ? esc(n) : 'szabad'}</span>
    <i class="coin-tip"></i><i class="coin-shine"></i>
  </div>`;
}

/* ---------------- Lánchíd-ágrajz: az ágak maguk a láncok ---------------- */
// Kétoldalú ágrajz: a játékosok fele balról, fele jobbról halad befelé, a döntő középen, a két kapu között.
// Ahol két lánc összeér, ott áll a pillér a következő meccsel. A győztes útja aranyban izzik.
const BW = 104, BH = 50, BG = 46, PAD = 12, FW = 136, FH = 62;
function bridgeGeo() {
  const R = rounds(); const side = R - 1;
  const W = PAD * 2 + side * 2 * (BW + BG) + FW;
  const TOP = 30; const topY = TOP + 22 + BH / 2; const S = BH + 16;
  const xOf = (r, s) => (s < 0 ? PAD + r * (BW + BG) : W - PAD - BW - r * (BW + BG));
  const pos = {}; let maxY = topY;
  for (let r = 0; r < side; r++) {
    const gs = T.games.filter((g) => g.r === r); const half = gs.length / 2;
    for (const g of gs) {
      const s = g.i < half ? -1 : 1; const k = g.i < half ? g.i : g.i - half;
      let y;
      if (r === side - 1) y = topY;
      else if (r === 0) y = topY + 72 + k * S;
      else { const a = pos[`${r - 1}:${2 * g.i}`]; const b = pos[`${r - 1}:${2 * g.i + 1}`]; y = (a.y + b.y) / 2 - 30; }
      pos[`${r}:${g.i}`] = { x: xOf(r, s), y, w: BW, h: BH, s };
      maxY = Math.max(maxY, y);
    }
  }
  const deckY = Math.max(maxY + BH / 2 + 34, topY + 150);
  pos[`${R - 1}:0`] = { x: W / 2 - FW / 2, y: deckY - FH / 2 - 28, w: FW, h: FH, s: 0 };
  if (T.bronze) pos['-1:0'] = { x: W / 2 - (BW + 12) / 2, y: deckY + 84, w: BW + 12, h: BH, s: 0 };
  const H = deckY + (T.bronze ? 140 : 74);
  return { R, side, W, H, deckY, topY, TOP, pos };
}
const f1 = (n) => n.toFixed(1);
function chainOf(geo, g) {
  const c = geo.pos[`${g.r}:${g.i}`]; const p = geo.pos[`${g.r + 1}:${g.i >> 1}`];
  const x1 = c.s < 0 ? c.x + c.w : c.x; const y1 = c.y;
  const x2 = c.s < 0 ? p.x : p.x + p.w; const y2 = p.s === 0 ? p.y - 6 : p.y;
  const cx = (x1 + x2) / 2; const cy = Math.max(y1, y2) + 16;
  let susp = '';
  for (let t = 0.12; t < 0.95; t += 0.09) {
    const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2; const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
    if (y < geo.deckY - 8) susp += `M${f1(x)} ${f1(y)}V${geo.deckY - 10}`;
  }
  return { d: `M${f1(x1)} ${f1(y1)}Q${f1(cx)} ${f1(cy)} ${f1(x2)} ${f1(y2)}`, susp };
}
function tower(cx, top, deck, big) {
  const foot = deck + 52;
  if (!big) return `<rect class="st" x="${f1(cx - 7)}" y="${f1(top)}" width="14" height="${f1(foot - top)}"/>`;
  // Lánchíd-kapu: két láb, köztük a nagy boltív, amin átmegy a híd
  const w = 92; const x = cx - w / 2; const aw = 40; const at = Math.max(top + 46, deck - 92);
  return `<g class="tower">
    <path class="st" fill-rule="evenodd" d="M${f1(x)} ${f1(top + 10)}H${f1(x + w)}V${deck}H${f1(cx + aw / 2)}V${f1(at + aw / 2)}A${aw / 2} ${aw / 2} 0 0 0 ${f1(cx - aw / 2)} ${f1(at + aw / 2)}V${deck}H${f1(x)}Z"/>
    <path class="pil" d="M${f1(x + 7)} ${f1(top + 22)}V${deck}M${f1(x + w - 7)} ${f1(top + 22)}V${deck}"/>
    <rect class="st2" x="${f1(x - 6)}" y="${f1(top)}" width="${w + 12}" height="11"/>
    <rect class="st2" x="${f1(x - 2)}" y="${f1(top + 16)}" width="${w + 4}" height="4"/>
    <path class="st2" d="M${f1(cx - aw / 2 - 6)} ${f1(at + aw / 2)}h12M${f1(cx + aw / 2 - 6)} ${f1(at + aw / 2)}h12" style="stroke:#e8dcbc;stroke-width:3"/>
    <rect class="st2" x="${f1(x - 4)}" y="${deck + 9}" width="${w + 8}" height="${foot - deck - 9}"/>
  </g>`;
}
function bnode(geo, g, cls = '') {
  const p = geo.pos[`${g.r}:${g.i}`]; const nx = nextGame();
  const side = (id, sc) => `<div class="bn-p ${!id && g.r === 0 ? 'bye' : g.w ? (g.w === id ? 'mw' : 'ml') : ''}"><span ${id ? `data-pid="${id}"` : ''}>${nm(id, g)}</span>${sc != null ? `<b>${sc}</b>` : g.wo && g.a && g.b && g.w === id ? '<b title="továbbléptetve">✓</b>' : ''}</div>`;
  return `<div class="bn ${cls} ${nx === g ? 'next' : ''} ${g.w ? 'done' : ''}" data-g="${g.r}:${g.i}" style="left:${f1(p.x)}px;top:${f1(p.y - p.h / 2)}px;width:${p.w}px;height:${p.h}px">${side(g.a, g.sa)}${side(g.b, g.sb)}</div>`;
}
function bridgeHTML() {
  const geo = bridgeGeo(); const { R, side, W, H, deckY, pos } = geo;
  let chains = ''; let towers = ''; let labels = '';
  for (const g of T.games.filter((x) => x.r >= 0 && x.r < R - 1)) {
    const { d, susp } = chainOf(geo, g); const key = `${g.r}:${g.i}`;
    chains += `<path class="susp" d="${susp}"/><path class="ch-base" d="${d}"/><path class="ch-link ${g.w ? 'won' : ''}" d="${d}"/>${g.w ? `<path class="ch-glow" data-c="${key}" pathLength="1" d="${d}"/>` : ''}`;
  }
  for (let r = 1; r < side; r++) for (const g of T.games.filter((x) => x.r === r)) {
    const p = pos[`${r}:${g.i}`]; towers += tower(p.x + p.w / 2, p.y + p.h / 2 + 2, deckY, r === side - 1);
  }
  if (side === 1) for (const g of T.games.filter((x) => x.r === 0)) { const p = pos[`0:${g.i}`]; towers += tower(p.x + p.w / 2, p.y + p.h / 2 + 2, deckY, true); }
  for (let r = 0; r < side; r++) {
    const any = T.games.find((x) => x.r === r); const half = T.games.filter((x) => x.r === r).length / 2;
    const l = pos[`${r}:0`]; const rr = pos[`${r}:${half}`];
    for (const p of [l, rr]) labels += `<div class="br-label" style="left:${f1(p.x)}px;width:${p.w}px;top:${geo.TOP - 24}px">${roundName(any.r)}</div>`;
  }
  const fin = gameAt(R - 1, 0); const fp = pos[`${R - 1}:0`];
  labels += `<div class="br-label fin" style="left:${f1(fp.x)}px;width:${fp.w}px;top:${f1(fp.y - fp.h / 2 - 26)}px">✦ Döntő · 2× ✦</div>`;
  const br = gameAt(-1, 0);
  if (br) { const bp = pos['-1:0']; labels += `<div class="br-label brz" style="left:${f1(bp.x)}px;width:${bp.w}px;top:${f1(bp.y - bp.h / 2 - 22)}px">Bronzmeccs</div>`; }
  const nodes = T.games.filter((g) => g.r >= 0 && g.r < R - 1).map((g) => bnode(geo, g)).join('') + bnode(geo, fin, 'final') + (br ? bnode(geo, br, 'bronze') : '');
  return `
    <div class="br-wrap"><div class="br-pan" style="width:${W}px;height:${H}px" data-w="${W}">
      <svg class="br-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <defs>
          <linearGradient id="br-st" x1="0" x2="1"><stop offset="0" stop-color="#9a8e70"/><stop offset=".35" stop-color="#d8ccaa"/><stop offset="1" stop-color="#7d7258"/></linearGradient>
          <linearGradient id="br-river" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1b2b52"/><stop offset="1" stop-color="#0a1226"/></linearGradient>
          <linearGradient id="br-deck" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f6dd8c"/><stop offset=".5" stop-color="#b8862b"/><stop offset="1" stop-color="#5a3d0c"/></linearGradient>
          <pattern id="br-rail" width="7" height="12" patternUnits="userSpaceOnUse"><rect x="2.5" width="2" height="12" fill="#c9a24a"/></pattern>
          <filter id="br-glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect x="0" y="${deckY + 8}" width="${W}" height="${H - deckY - 8}" fill="url(#br-river)"/>
        <g class="waves">${Array.from({ length: 7 }, (_, k) => { const y = deckY + 22 + k * 15; return `<path d="M0 ${y}${Array.from({ length: Math.ceil(W / 40) }, (__, q) => ` q10 ${k % 2 ? 3 : -3} 20 0 t20 0`).join('')}"/>`; }).join('')}</g>
        ${towers}
        <rect class="st" x="0" y="${deckY - 2}" width="34" height="${H - deckY + 2}"/><rect class="st" x="${W - 34}" y="${deckY - 2}" width="34" height="${H - deckY + 2}"/>
        <g class="chains">${chains}</g>
        <rect x="0" y="${deckY - 12}" width="${W}" height="12" fill="url(#br-rail)" opacity=".75"/>
        <rect x="0" y="${deckY - 13}" width="${W}" height="2.2" fill="#e5c46a"/>
        <rect x="0" y="${deckY}" width="${W}" height="9" fill="url(#br-deck)"/>
      </svg>
      ${labels}${nodes}
    </div></div>
    <p class="br-hint">‹ húzd oldalra a hidat ›</p>`;
}
// mi a tét: hova jut a győztes
function stakeOf(g) {
  if (g.r === -1) return 'A győztes <b>bronzérmet</b> kap';
  if (isFinal(g)) return 'A győztes <b>a Lánchíd Kupa bajnoka</b>';
  const k = rounds() - 2 - g.r;
  return `A győztes <b>${k === 0 ? 'a döntőbe' : k === 1 ? 'az elődöntőbe' : k === 2 ? 'a negyeddöntőbe' : 'a következő fordulóba'}</b> jut`;
}
function bracketView() {
  const nx = nextGame();
  return `
    <section class="ar">
      ${head('Lánchíd Kupa', `${T.size} fő · ${roman(new Date().getFullYear())}`)}
      ${nx ? `<div class="br-next"><small>${isFinal(nx) ? '⚔️ A DÖNTŐ · 2x pont' : nx.r === -1 ? 'Bronzmeccs' : 'Következő meccs · ' + roundName(nx.r)}</small><div class="nx-vs"><div class="nx-p"><b>${nm(nx.a)}</b><span>ELO ${playerById(nx.a)?.elo ?? '–'}</span></div><i>vs</i><div class="nx-p"><b>${nm(nx.b)}</b><span>ELO ${playerById(nx.b)?.elo ?? '–'}</span></div></div>
        <div class="nx-stake">${stakeOf(nx)}</div>
        <button type="button" class="btn ar-gold sm" data-ar-rec="${nx.r}:${nx.i}">Eredmény rögzítése</button></div>` : ''}
      ${bridgeHTML()}
      ${isBoss() && T.status === 'running' ? `<button type="button" class="ar-link" data-ar-manage>${state.me.is_admin ? '🛠 Kupa kezelése (admin)' : '🛠 Kupa kezelése (kiíró)'}</button>` : ''}
      ${szechenyi('', 'running', 'small play')}
      ${orn}
    </section>`;
}
// a híd beállítása megjelenés után: kicsinél ráigazítás, nagynál görgetés a következő meccsre
function fitBridge(smooth) {
  const wrap = $app.querySelector('.br-wrap'); const pan = wrap?.querySelector('.br-pan'); if (!pan) return;
  const W = +pan.dataset.w; const avail = wrap.clientWidth;
  const z = W > avail && avail / W > 0.78 ? avail / W : 1; pan.style.zoom = z;
  $app.querySelector('.br-hint').hidden = W * z <= avail + 2;
  const nx = $app.querySelector('.hl-page') ? null : nextGame(); const el = $app.querySelector(nx ? `.bn[data-g="${nx.r}:${nx.i}"]` : '.bn.final');
  if (el) wrap.scrollTo({ left: (el.offsetLeft + el.offsetWidth / 2) * z - avail / 2, behavior: smooth ? 'smooth' : 'auto' });
}


function championView() {
  const c = T.champion; const fin = gameAt(rounds() - 1, 0);
  return `
    <section class="ar champ">
      ${head('Lánchíd Kupa', 'Bajnokunk')}
      <div class="champ-name">${esc(nameOf(c))}</div>
      <div class="champ-sub">A döntőben: ${esc(nameOf(c))} – ${esc(nameOf(c === fin.a ? fin.b : fin.a))} ${fin.wo ? '(továbbléptetés)' : c === fin.a ? `${fin.sa}:${fin.sb}` : `${fin.sb}:${fin.sa}`}</div>
      ${szechenyi(`Bajnok:<br>${esc(nameOf(c))}`, 'done')}
      <div class="ar-cta">
        <a class="btn block ar-ghost" href="#/bajnoksag/csarnok">🖼 Arcképcsarnok</a>
        <button type="button" class="btn block ar-ghost" data-ar-bracket>Az ágrajz megtekintése</button>
      </div>
      ${orn}
    </section>`;
}

/* ---------------- Arcképcsarnok ---------------- */
const initials = (n) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
const hallKey = (h) => h.id;
const SEEN = 'sziszpong.hallSeen';
const seenList = () => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { return []; } };
const markSeen = (h) => { try { localStorage.setItem(SEEN, JSON.stringify([...seenList(), hallKey(h)].slice(-30))); } catch { /* nem baj */ } };
// új bajnok: az első megnyitáskor mindenkinél beleég a neve (2 héten belüli kupánál)
const isFresh = (h) => !seenList().includes(hallKey(h)) && Date.now() - new Date(h.at).getTime() < 14 * DAY;
const portraitHTML = (h, k = 0, cls = '') => `
  <figure class="portrait ${cls}" style="animation-delay:${k * 90}ms">
    <div class="pf"><div class="pc"><div class="cameo"><span>${esc(initials(h.name))}</span></div></div></div>
    <figcaption class="plate"><b class="bt">${esc(h.name)}</b><small class="bt">${romanDate(h.at)} · ${h.size} fő</small></figcaption>
  </figure>`;
function hallView() {
  const list = HALL().reverse();
  return `
    <section class="ar">
      ${head('Arcképcsarnok', 'A Lánchíd Kupa bajnokai')}
      <div class="hall">${list.map((h, k) => portraitHTML(h, k, k === 0 && isFresh(h) ? 'pending' : '')).join('')}</div>
      <p class="ar-note">Minden bajnok ide kerül, aranykeretben, örök dicsőségben.</p>
      ${cupTable()}
      ${orn}
    </section>`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// a név és a dátum tüzesen beleég a réztáblába, majd a kép és a tábla leszáll a helyére
async function burnIn(fig) {
  const h = HALL().reverse()[0]; markSeen(h);
  if (reduced()) { fig.classList.remove('pending'); return; }
  window.scrollTo(0, 0); await sleep(60);
  const tr = fig.getBoundingClientRect(); const k = Math.min(1.55, (window.innerWidth - 60) / tr.width);
  const two = (t) => `<span class="cold">${t}</span><span class="hot">${t}</span><i class="edge"></i>`;
  const ov = document.createElement('div'); ov.className = 'burn';
  ov.innerHTML = `<div class="burn-bg"></div><div class="burn-title">Új név az Arcképcsarnokban</div>
    <figure class="portrait big" style="width:${tr.width}px;left:${(window.innerWidth - tr.width) / 2}px;top:${Math.max(110, window.innerHeight / 2 - tr.height / 2 + 30)}px;--k:${k}">
      <div class="pf"><div class="pc"><div class="cameo"><span>${esc(initials(h.name))}</span></div></div></div>
      <figcaption class="plate hot-plate"><b class="bt burnt" data-bt="0">${two(esc(h.name))}</b><small class="bt burnt" data-bt="1">${two(`${romanDate(h.at)} · ${h.size} fő`)}</small></figcaption>
    </figure>`;
  document.body.appendChild(ov);
  const big = ov.querySelector('.portrait.big');
  await sleep(1000);
  for (const [i, dur] of [[0, 1500], [1, 1100]]) await burnLine(ov, ov.querySelector(`[data-bt="${i}"]`), dur);
  ov.classList.add('cool'); await sleep(1500);
  const a = big.getBoundingClientRect(); const b = fig.getBoundingClientRect();
  ov.classList.add('land');
  const dx = b.left + b.width / 2 - (a.left + a.width / 2); const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  await big.animate([{ transform: `scale(${k})` }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], { duration: 950, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' }).finished;
  fig.classList.remove('pending'); fig.classList.add('landed'); ov.remove();
}
async function burnLine(ov, el, dur) {
  const edge = el.querySelector('.edge');
  el.querySelectorAll('.cold, .hot').forEach((s) => s.animate([{ clipPath: 'inset(-30% 100% -30% 0)' }, { clipPath: 'inset(-30% 0 -30% 0)' }], { duration: dur, easing: 'linear', fill: 'forwards' }));
  edge.animate([{ left: '0%', opacity: 1 }, { left: '100%', opacity: 1 }, { left: '100%', opacity: 0 }], { duration: dur + 250, easing: 'linear', fill: 'forwards' });
  const t0 = performance.now(); let last = 0;
  await new Promise((done) => {
    const tick = (now) => {
      const r = edge.getBoundingClientRect();
      if (now - last > 34) {
        last = now;
        for (let q = 0; q < 2; q++) {
          const e = document.createElement('i'); e.className = 'ember';
          e.style.cssText = `left:${r.left}px;top:${r.top + Math.random() * r.height}px;--dx:${(Math.random() * 50 - 25).toFixed(0)}px;--dy:${(-30 - Math.random() * 60).toFixed(0)}px;--t:${(0.7 + Math.random() * 0.7).toFixed(2)}s`;
          ov.appendChild(e); setTimeout(() => e.remove(), 1500);
        }
        if (Math.random() < 0.35) {
          const sm = document.createElement('i'); sm.className = 'smoke';
          sm.style.cssText = `left:${r.left - 10}px;top:${r.top - 6}px;--dx:${(Math.random() * 30 - 15).toFixed(0)}px`;
          ov.appendChild(sm); setTimeout(() => sm.remove(), 2200);
        }
      }
      if (now - t0 < dur) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  await sleep(250);
}


// kupagyőzelmek kis táblázata a Csarnok alján
function cupTable() {
  const rows = {};
  for (const c of archive()) {
    const f = c.games.find((g) => g.r === Math.log2(c.size) - 1);
    for (const id of [f.a, f.b]) { const n = nameOf(id); rows[n] = rows[n] || { w: 0, f: 0 }; rows[n].f++; if (id === c.champion) rows[n].w++; }
  }
  const list = Object.entries(rows).sort((a, b) => b[1].w - a[1].w || b[1].f - a[1].f);
  if (!list.length) return '';
  return `
    <div class="section-ar">Kupavadászok</div>
    <div class="cups">
      <div class="cups-h"><span></span><span>Játékos</span><span>🏆</span><span>Döntő</span></div>
      ${list.map(([n, v], i) => `<div class="cups-r"><span class="cn">${roman(i + 1)}.</span><span>${esc(n)}</span><b>${v.w}</b><span>${v.f}</span></div>`).join('')}
    </div>`;
}

/* ---------------- Hírlap: a lezárt kupák archívuma, mindegyik egy különkiadás ---------------- */
// egy lezárt kupán futtat valamit úgy, mintha az lenne az aktuális (az ágrajz-rajzoló a T-t olvassa)
function withCup(c, fn) {
  const saved = { ...T };
  Object.assign(T, { size: c.size, bronze: c.bronze, games: c.games, champion: c.champion, status: 'done', entries: c.entries });
  try { return fn(); } finally { Object.keys(T).forEach((k) => delete T[k]); Object.assign(T, saved); }
}
/* ---------------- Hírmotor: helyzetek felismerése + sok sablon ---------------- */
// Minden helyzethez több megfogalmazás tartozik; a kupa azonosítójából kevert "véletlen" választ,
// így ugyanaz a kupa mindig ugyanazt az újságot kapja, de két kupa ritkán szól ugyanúgy.
// A nevek mindig ragozatlanul állnak (így nem lesz „Kata-t” típusú hiba).
const hashStr = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
function picker(seed) {
  let a = hashStr(seed);
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (list) => list[Math.floor(rnd() * list.length)];
}
const fill = (t, v) => t.replace(/\b(a|A) \{(\w+)\}\./g, (m, a, k) => `${artOf(v[k], a)} {${k}}.`).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
// névelő számok elé: „az 5.”, „a 3.”
const artOf = (n, a) => { n = +n; const az = n === 1 || n === 5 || (n >= 50 && n < 60); return (a === 'A' ? 'A' : 'a') + (az ? 'z' : ''); };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const TPL = {
  head: {
    normal: ['{W} a Lánchíd Kupa bajnoka!', '{W} elvitte a kupát!', 'Új név a kupán: {W}!', '{W} felért a híd tetejére!', 'Éljen {W}, a bajnok!', '{W} emelte magasba a serleget!'],
    repeat: ['Ismét {W}!', '{W} megvédte a címét!', 'A trón marad: {W} újra bajnok!', 'Nincs új a nap alatt: megint {W}!'],
    first: ['{W} első kupagyőzelme!', 'Megszületett egy bajnok: {W}!', '{W} először emelhette a magasba a kupát!'],
    dynasty: ['{W}-korszak a KGY-teremben?', 'Megállíthatatlan: {W} {N}. kupája!', 'Dinasztia születik: {W} immár {N}-szoros bajnok!'],
    underdog: ['Senki sem számított rá: {W} a bajnok!', 'Hamupipőke-történet: {W} nyert!', 'Borult a papírforma: {W} a bajnok!', 'A sötét ló befutott: {W}!'],
    favourite: ['A papírforma érvényesült: {W} a bajnok!', 'Nem volt meglepetés: {W} nyert!', 'A legerősebb jutott fel a csúcsra: {W}!'],
    organizer: ['A kiíró maga vitte el: {W}!', 'Kiírta, megnyerte: {W}!', 'Házigazda-győzelem: {W} a bajnok!', 'A kiíró kupát nyert: {W}!'],
  },
  deck: {
    close: ['A döntőben {A} – {B} {S}, hosszabbításban dőlt el. {L} ezüstérmes.', 'Drámai döntő: {A} – {B} {S}. {L} karnyújtásnyira volt.', 'Az utolsó labdáig izgalmas volt: {A} – {B} {S}.'],
    blowout: ['Egyoldalú döntő: {A} – {B} {S}. {L} ezüstérmes.', 'Nem volt kérdés: {A} – {B} {S} a döntőben.', 'Fölényes fináléban {A} – {B} {S}.'],
    normal: ['A döntőben {A} – {B} {S}. {L} ezüstérmes.', 'A finálé: {A} – {B} {S}. Ezüstérem: {L}.', '{A} – {B} {S} a döntőben. Gratulálunk mindkettőjüknek!'],
    walkover: ['A döntő elmaradt, {W} játék nélkül emelhette a magasba a kupát. {L} ezüstérmes.', 'Nem volt döntő: {W} továbbléptetéssel lett bajnok. Ezüstérem: {L}.'],
  },
  items: {
    upset: [
      ['Nagy skalp {W} övén', '{S} {L} ellen {R}, pedig {D} ELO-ponttal gyengébbnek számított.'],
      ['Senki sem fogadott volna rá: {W} – {L} {S}', '{D} ELO-pont hátrányból jutott tovább {R}.'],
      ['Dávid és Góliát: {W} – {L} {S}', '{D} ELO-pont különbség sem számított {R}.'],
      ['Meglepetés {R}: {W} továbbjutott', 'A papírforma {L} mellett szólt ({D} ELO-ponttal), mégis {S} lett a vége.'],
      ['Borult a papírforma {R}', '{W} – {L} {S}, pedig {D} ELO-pont volt köztük.'],
    ],
    tight: [
      ['Hajszálon múlt: {A} – {B} {S}', 'Hosszabbításban dőlt el.'],
      ['Idegek harca: {A} – {B} {S}', 'Az utolsó labdákon múlt.'],
      ['Körömrágós meccs {R}', '{A} – {B} {S}, a hosszabbítás döntött.'],
      ['Ezt nem lehetett szorosabban: {A} – {B} {S}', 'Két pont döntött a hosszabbításban.'],
    ],
    bagel: [
      ['Nullás! {W} – {L} {S}', 'Berceli bácsi büszke lenne.'],
      ['Pont nélkül búcsúzott: {L}', '{W} egyetlen pontot sem engedett, {S}.'],
    ],
    blowout: [
      ['Lemosta az asztalról: {W} – {L} {S}', 'Rövid volt és fájdalmas.'],
      ['Villámgyors győzelem: {W} – {L} {S}', '{R} ez volt a legsimább meccs.'],
      ['Esélye sem volt: {L}', '{W} – {L} {S} {R}.'],
    ],
    defenderOut: [
      ['Elbukott a címvédő: {C}', 'A hóhér: {K}, {S} {R}.'],
      ['Új király kell: kiesett {C}', '{K} állta útját, {S} {R}.'],
      ['Leszállt a trónról {C}', '{R} {K} búcsúztatta, {S}.'],
    ],
    defenderFinal: [
      ['A címvédő {C} a döntőig menetelt', 'Egy lépés hiányzott a duplázáshoz.'],
      ['{C} közel volt a duplához', 'A döntőben akadt meg.'],
    ],
    rematch: [
      ['Visszavágó a döntőben: {A} – {B}', 'Ugyanez a páros vívta a {N}. kupa döntőjét is.'],
      ['Ismerős döntő: {A} és {B} ismét', 'A {N}. kupa fináléja ismétlődött meg.'],
    ],
    silverAgain: [
      ['Örök második? {L} újra ezüstérmes', 'Már a {N}. döntője, amit elveszített.'],
      ['{L} ismét a dobogó második fokán', 'Egyszer eljön a nagy nap.'],
    ],
    dominant: [
      ['Fölényes menetelés: {W}', 'Az egész kupán mindössze {P} pontot engedett.'],
      ['{W} szinte hibátlan volt', 'Meccsenként átlag {A} pontot adott le.'],
    ],
    debut: [
      ['Berobbant az újonc: {N}', 'Első kupáján rögtön {R} jutott.'],
      ['Új arc, nagy menetelés: {N}', 'Első Lánchíd Kupáján {R} jutott.'],
    ],
    organizer: [
      ['A kiíró, {N}, {R} jutott', 'Kiírni és játszani is tud.'],
      ['Házigazda: {N}', 'A kupa kiírója {R} jutott.'],
    ],
    organizerWin: [
      ['A kiíró kupát nyert!', 'Bundát kiáltanak a kételkedők! {W} szerint minden tisztán zajlott.'],
      ['Bundagyanú a KGY-teremben?', 'A kiíró, {W}, maga vitte el a kupát. Bundát kiáltanak a kételkedők!'],
      ['Kiírta, megnyerte, hazavitte', 'A kételkedők bundát kiáltanak, {W} csak mosolyog.'],
      ['Saját kupáját nyerte meg: {W}', 'Kiírta, végigverekedte, megnyerte. Ilyen a jó házigazda.'],
      ['Házigazdához illő győzelem', '{W} nemcsak kiírta a kupát, hanem meg is nyerte.'],
      ['A szervező a csúcson', '{W} bebizonyította, hogy nemcsak kiírni tud kupát.'],
      ['Ki mint vet, úgy arat', '{W} elvetette a kupa magját, és ő is aratott.'],
    ],
    organizerOut: [
      ['A házigazda korán búcsúzott', 'A kiíró, {N}, már {R} kiesett. De a kupát neki köszönhetjük!'],
      ['Kiírta, de nem neki termett babér', '{N} {R} kiesett. Köszönjük a szervezést!'],
    ],
    bronze: [
      ['Bronzérem: {W}', 'A bronzmeccsen {S}.'],
      ['{W} a dobogó harmadik fokán', 'A bronzmeccs: {S}.'],
      ['A vigaszág győztese: {W}', '{S} a bronzmeccsen, {L} negyedik lett.'],
      ['Bronz is fém!', '{W} – {L} {S}. Nem arany, de a vitrinben ez is csillog.'],
      ['Dobogós lett: {W}', 'A bronzmeccsen {S}. A KGY-terem legjobb hármában a helye, és ezt most már mindenki tudja.'],
    ],
    marathon: [
      ['A kupa leghosszabb meccse: {A} – {B} {S}', 'Összesen {P} pont, ennél többet senki sem játszott.'],
    ],
    numbers: [
      ['Számokban', '{N} nevező · {M} mérkőzés · {P} pont · kiírta: {O}'],
      ['A kupa mérlege', '{M} meccs, összesen {P} pont, {N} versenyzővel. Kiírta: {O}.'],
    ],
  },
};
const stageTo = (r, R) => { const k = R - 1 - r; return k === 0 ? 'a döntőbe' : k === 1 ? 'az elődöntőbe' : k === 2 ? 'a negyeddöntőbe' : 'a második körbe'; };
const stageIn = (r, R) => { if (r === -1) return 'a bronzmeccsen'; const k = R - 1 - r; return k === 0 ? 'a döntőben' : k === 1 ? 'az elődöntőben' : k === 2 ? 'a negyeddöntőben' : 'az első körben'; };
function newsOf(c) {
  const pick = picker(c.id + c.at);
  const R = Math.log2(c.size); const fin = c.games.find((g) => g.r === R - 1); const W = c.champion; const L = fin.w === fin.a ? fin.b : fin.a;
  const nm = nameOf; const sc = (g) => `${g.sa}:${g.sb}`;
  const scW = (g) => (g.w === g.a ? `${g.sa}:${g.sb}` : `${g.sb}:${g.sa}`);   // a győztes pontja elöl
  const played = c.games.filter((g) => g.a && g.b && g.w && !g.wo);   // továbbléptetés nem számít meccsnek
  const elo = (id) => c.elo?.[id] ?? playerById(id)?.elo ?? 1000;   // a sorsoláskori ELO
  const all = archive(); const prev = all.slice(0, all.findIndex((x) => x.id === c.id));
  const prevChamp = prev[prev.length - 1]?.champion;
  const titles = prev.filter((x) => x.champion === W).length + 1;
  const loserOf = (g) => (g.w === g.a ? g.b : g.a);
  const lostAt = (id) => played.find((g) => loserOf(g) === id && g.r >= 0);
  const outAt = (id) => c.games.find((g) => g.a && g.b && g.w && loserOf(g) === id && g.r >= 0);   // továbbléptetéssel is
  // főcím
  const byElo = [...c.entries].sort((a, b) => elo(b) - elo(a));
  const seedPos = byElo.indexOf(W);
  let hk = 'normal';
  if (titles >= 3) hk = 'dynasty'; else if (prevChamp === W) hk = 'repeat'; else if (seedPos >= Math.ceil(c.entries.length / 2)) hk = 'underdog';
  else if (titles === 1 && prev.length && pick([0, 1])) hk = 'first'; else if (seedPos === 0 && pick([0, 1])) hk = 'favourite'; else if (W === c.by && pick([0, 1])) hk = 'organizer';
  const head = fill(pick(TPL.head[hk]), { W: nm(W), N: titles });
  const fd = Math.abs(fin.sa - fin.sb);
  const deck = fill(pick(TPL.deck[fin.wo ? 'walkover' : Math.max(fin.sa, fin.sb) > 11 ? 'close' : fd >= 7 ? 'blowout' : 'normal']), { A: nm(W), B: nm(L), S: scW(fin), L: nm(L), W: nm(W) });   // a győztes elöl
  // hírek: minden felismert helyzet egy jelölt, fontossági sorrendben; a végén legfeljebb 5 kerül be
  const cand = [];
  const used = new Set();
  const add = (key, prio, v, g) => { if (g && used.has(g)) return; if (g) used.add(g); const [h, t] = pick(TPL.items[key]); cand.push({ prio, h: cap(fill(h, v)), t: cap(fill(t, v)) }); };
  const ups = played.filter((g) => g.r !== R - 1).map((g) => ({ g, d: elo(loserOf(g)) - elo(g.w) })).sort((x, y) => y.d - x.d)[0];
  if (prevChamp && prevChamp !== W && c.entries.includes(prevChamp)) {
    const g = lostAt(prevChamp);
    if (g && g.r === R - 1) add('defenderFinal', 88, { C: nm(prevChamp) });
    else if (g) add('defenderOut', 95, { C: nm(prevChamp), K: nm(g.w), S: scW(g), R: stageIn(g.r, R) }, g);
  }
  if (ups && ups.d >= 25) add('upset', 90 + Math.min(ups.d / 10, 9), { W: nm(ups.g.w), L: nm(loserOf(ups.g)), S: scW(ups.g), D: ups.d, R: stageIn(ups.g.r, R) }, ups.g);
  const prevFinal = prev.map((x, i) => ({ x, i, f: x.games.find((g) => g.r === Math.log2(x.size) - 1) })).reverse().find(({ f }) => f && [f.a, f.b].sort().join() === [fin.a, fin.b].sort().join());
  if (prevFinal) add('rematch', 85, { A: nm(fin.a), B: nm(fin.b), N: prevFinal.i + 1 });
  const silver = prev.filter((x) => { const f = x.games.find((g) => g.r === Math.log2(x.size) - 1); return f && f.w && loserOf(f) === L; }).length + 1;
  if (silver >= 2) add('silverAgain', 80, { L: nm(L), N: silver });
  const bagel = played.find((g) => Math.min(g.sa, g.sb) === 0);
  if (bagel) add('bagel', 84, { W: nm(bagel.w), L: nm(loserOf(bagel)), S: scW(bagel) });
  else { const bl = played.filter((g) => Math.min(g.sa, g.sb) <= 3).sort((x, y) => Math.min(x.sa, x.sb) - Math.min(y.sa, y.sb))[0]; if (bl) add('blowout', 60, { W: nm(bl.w), L: nm(loserOf(bl)), S: scW(bl), R: stageIn(bl.r, R) }); }
  const tight = played.filter((g) => Math.max(g.sa, g.sb) > 11 && g.r !== -1).sort((x, y) => Math.max(y.sa, y.sb) - Math.max(x.sa, x.sb))[0];
  if (tight && tight !== fin) add('tight', 70, { A: nm(tight.a), B: nm(tight.b), S: sc(tight), R: stageIn(tight.r, R) });
  const wg = played.filter((g) => g.w === W && g.r >= 0); const conceded = wg.reduce((s, g) => s + (g.a === W ? g.sb : g.sa), 0);
  if (wg.length >= 2 && conceded / wg.length <= 6) add('dominant', 75, { W: nm(W), P: conceded, A: (conceded / wg.length).toFixed(1).replace('.', ',') });
  const newbies = c.entries.filter((id) => !prev.some((x) => x.entries.includes(id)) && id !== W && id !== L);
  const deb = newbies.map((id) => { const g = outAt(id); return { id, r: g ? g.r : R }; }).filter((x) => prev.length && x.r >= R - 2).sort((a, b) => b.r - a.r)[0];
  if (deb) add('debut', 65, { N: nm(deb.id), R: stageTo(deb.r, R) });
  if (c.by && c.by === W) { const [h, t] = pick(TPL.items.organizerWin.slice(hk === 'organizer' ? 1 : 0)); cand.push({ prio: 86, h: fill(h, { W: nm(W) }), t: fill(t, { W: nm(W) }) }); }
  if (c.by && c.by !== W && c.by !== L) { const g = outAt(c.by); if (g) add(g.r <= R - 3 ? 'organizerOut' : 'organizer', 40, { N: nm(c.by), R: g.r <= R - 3 ? stageIn(g.r, R) : stageTo(g.r, R) }); }
  const br = c.games.find((g) => g.r === -1 && g.w);
  if (br) add('bronze', 72, { W: nm(br.w), L: nm(loserOf(br)), S: scW(br) });
  const pts = (g) => g.sa + g.sb; const mar = [...played].sort((x, y) => pts(y) - pts(x))[0];
  if (mar && pts(mar) >= 24 && mar !== tight) add('marathon', 50, { A: nm(mar.a), B: nm(mar.b), S: sc(mar), P: pts(mar) });
  const items = cand.sort((a, b) => b.prio - a.prio).slice(0, 5);
  const [nh, nt] = pick(TPL.items.numbers);
  items.push({ h: nh, t: fill(nt, { N: c.entries.length, M: played.length, P: played.reduce((s, g) => s + pts(g), 0), O: nm(c.by) }) });
  return { head, deck, items, played: played.length };
}
const editionNo = (c) => archive().findIndex((x) => x.id === c.id) + 1;
let openCup = null; let showBridge = false;
function heraldView() {
  const list = [...archive()].reverse();
  const c = list.find((x) => x.id === openCup);
  if (c) return frontPage(c);
  return `
    <section class="ar">
      ${head('Hírlap', 'A Lánchíd Kupák krónikája')}
      ${list.length ? `<div class="hl-stack">${list.map((x, k) => { const n = newsOf(x); return `
        <button type="button" class="hl-mini" data-cup="${x.id}" style="--r:${k % 2 ? 0.6 : -0.5}deg">
          <span class="hl-mast">SZISZ Hírlap</span>
          <span class="hl-sub"><span>${editionNo(x)}. különkiadás</span><span>${romanDate(x.at)}</span></span>
          <b class="hl-head">${esc(n.head)}</b>
          <span class="hl-deck">${esc(n.deck)}</span>
          <span class="hl-go">Elolvasom ›</span>
        </button>`; }).join('')}</div>`
        : '<p class="ar-note">Még nem zajlott Lánchíd Kupa. Az első különkiadás a te kupád lehet!</p>'}
      ${orn}
    </section>`;
}
function frontPage(c) {
  const n = newsOf(c); const a = artFor('done');
  return `
    <section class="ar">
      <button type="button" class="hl-back" data-hl-back>‹ Összes kiadás</button>
      <article class="hl-page">
        <div class="hl-mast big">SZISZ Hírlap</div>
        <div class="hl-sub"><span>${editionNo(c)}. különkiadás</span><span>${romanDate(c.at)}</span><span>Ára: egy labda</span></div>
        <h2 class="hl-head big">${esc(n.head)}</h2>
        <p class="hl-deck big">${esc(n.deck)}</p>
        <div class="hl-body">
          <figure class="hl-pic"><img src="${a.src}" alt=""><figcaption>A bajnok a kupával</figcaption></figure>
          <div class="hl-col">
            ${n.items.map((it) => `<div class="hl-item"><b>${esc(it.h)}</b><span>${esc(it.t)}</span></div>`).join('')}
          </div>
        </div>
        <button type="button" class="hl-bridge-btn" data-hl-bridge>${showBridge ? 'A híd elrejtése' : 'A teljes híd megtekintése ›'}</button>
      </article>
      ${showBridge ? withCup(c, () => bridgeHTML()) : ''}
      ${orn}
    </section>`;
}

function rulesView() {
  return `
    <section class="ar">
      ${head('Szabályok', 'A Lánchíd Kupa rendje')}
      <div class="proc rules">
        <ol>
          <li><b>Bárki kiírhat</b> egy Lánchíd Kupát: 4, 8 vagy 16 fővel. Egyszerre egy kupa futhat.</li>
          <li>A jelentkezés a határidőig tart. Ha betelt, a határidő lejárt, vagy a kiíró elindítja, <b>az app sorsol</b> (legalább 4 nevező kell, különben a kupa elmarad).</li>
          <li>A két legerősebb az ágrajz két végére kerül. Ha nem telt be, a legerősebbek <b>erőnyerők</b>.</li>
          <li><b>Egyenes kieséses:</b> minden párharc egy meccs, a győztes továbbjut.</li>
          <li>Minden meccs számít az ELO-ba, <b>a döntő 2x pontot ér</b>.</li>
          <li>Bárki rögzítheti a kupameccset a szokásos módon: a meccsrögzítőn a <b>🏆 Bajnoki meccs</b> kapcsoló magától bekapcsol.</li>
          <li>Egy meccs lejátszására 1 nap van. Ha addig elmarad, a kiíró (vagy Balázs) továbbléptetheti az egyik játékost, ELO nélkül.</li>
          <li>A bajnok bekerül az <b>Arcképcsarnokba</b>.</li>
        </ol>
      </div>
      <div class="special">
        <div class="special-ic">✉️</div>
        <div><b>Egyedi bajnokság?</b><p>Karácsonyi, majálisos vagy bármilyen különleges kupát Balázs tud indítani, saját témával és szabályokkal. Beszélj vele!</p></div>
      </div>
      ${orn}
    </section>`;
}

/* ---------------- animációk ---------------- */
function curtain(mid, onOpen, hold = 1300) {
  const top = (document.querySelector('.topbar')?.offsetHeight || 0) + 'px';
  const c = document.createElement('div');
  c.className = 'curtain'; c.style.top = top;
  c.innerHTML = `<div class="cu l"></div><div class="cu r"></div><div class="cu-mid">${mid}</div>`;
  document.body.appendChild(c);
  requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('shut')));
  setTimeout(() => { onOpen(); c.classList.add('open'); }, 450 + hold);
  setTimeout(() => c.remove(), 450 + hold + 1500);
}
function goldDust(n = 70) {
  const box = document.createElement('div'); box.className = 'dust';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    d.style.left = Math.random() * 100 + '%';
    d.style.animationDelay = (Math.random() * 1.8).toFixed(2) + 's';
    d.style.animationDuration = (2.6 + Math.random() * 2.4).toFixed(2) + 's';
    d.style.setProperty('--dx', (Math.random() * 80 - 40).toFixed(0) + 'px');
    d.style.setProperty('--s', (0.5 + Math.random()).toFixed(2));
    box.appendChild(d);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}
const rerender = () => { $app.innerHTML = arenaView(); bindArena(); };
const rerenderSub = (sub) => { $app.innerHTML = arenaView(sub); bindArena(sub); };
const onKupa = () => /^#\/bajnoksag\/?$/.test(location.hash);
const act = (fn, args) => rpc(fn, { p_token: state.token, p_tour: T.id, ...args });

/* ---------------- műveletek ---------------- */
export function plusAction() {
  syncT();
  if (T.status === 'none' || T.status === 'done') return openCreate();
  if (T.status === 'reg') { if (T.entries.includes(me())) toast('Már jelentkeztél. ✍️'); else join(); return; }
  const nx = nextGame(); if (nx) goRecord(nx);
}
export function plusLabel() {
  syncT();
  return T.status === 'reg' ? (T.entries.includes(me()) ? 'Jelentkeztél' : 'Jelentkezem') : T.status === 'running' ? 'Rögzítés' : 'Kiírás';
}

function openCreate() {
  if (!onKupa()) location.hash = '#/bajnoksag';
  modal({
    title: 'Lánchíd Kupa kiírása',
    text: 'Egyenes kieséses, a döntő 2x pontot ér. Te is automatikusan nevezel.',
    body: `
      <div class="field"><span>Létszám</span><div class="chips ar-size">${[4, 8, 16].map((n) => `<button type="button" class="chip ${n === 8 ? 'active' : ''}" data-n="${n}">${n} fő</button>`).join('')}</div></div>
      <label class="field"><span>Jelentkezési határidő</span>
        <select class="select" name="dl"><option value="1">holnap ilyenkor</option><option value="2" selected>2 nap múlva</option><option value="3">3 nap múlva</option></select></label>
      <label class="ar-check"><input type="checkbox" name="bronze" checked> Bronzmeccs a 3. helyért</label>
      <label class="field"><span>Üzenet (nem kötelező)</span><input class="input" name="msg" maxlength="140" placeholder="pl. Péntek este 8-tól a teremben 🏓"></label>`,
    okText: 'Kiírom ⚔️',
    onOk: async (f) => {
      await rpc('tournament_create', {
        p_token: state.token, p_size: +(f.querySelector('.ar-size .active')?.dataset.n || 8), p_bronze: f.elements.bronze.checked,
        p_message: f.elements.msg.value.trim() || null, p_reg_days: +f.elements.dl.value,
      });
      await loadTour();
      setTimeout(() => { rerender(); stampAnim(0); }, 0);
    },
  });
  document.querySelectorAll('#modal .ar-size .chip').forEach((c) => { c.onclick = () => document.querySelectorAll('#modal .ar-size .chip').forEach((x) => x.classList.toggle('active', x === c)); });
  document.querySelector('#modal-form [type=submit]')?.classList.add('ar-gold');
}

// a pecsét rányomódik, a név pedig belevésődik az érmébe (vésőhegy + szikrák + végül fénycsík)
function stampAnim(slot) {
  const seal = $app.querySelector('.seal'); const m = $app.querySelector(`.coin[data-slot="${slot}"]`);
  seal?.classList.remove('stamp'); void seal?.offsetWidth; seal?.classList.add('stamp');
  if (!m) return;
  m.classList.add('engrave');
  for (let k = 0; k < 14; k++) {
    const sp = document.createElement('i'); sp.className = 'chip-spark';
    const t = 0.95 + (k / 14) * 1.05;
    sp.style.cssText = `--l:${(24 + (k / 14) * 52).toFixed(0)}%;--dx:${(Math.random() * 36 - 18).toFixed(0)}px;--dy:${(-8 - Math.random() * 22).toFixed(0)}px;animation-delay:${t.toFixed(2)}s`;
    m.appendChild(sp);
  }
}
async function join() {
  const btn = $app.querySelector('[data-ar-join]');
  await busy(btn, async () => {
    const r = await act('tournament_join');
    await loadTour();
    if (r.drawn) drawAnim();
    else { rerender(); stampAnim(T.entries.indexOf(me())); }
    toast(r.drawn ? 'Betelt a kupa, jöhet a sorsolás! 🎭' : 'Jelentkeztél! ✍️', 'ok');
  });
}
async function leave() {
  await busy($app.querySelector('[data-ar-leave]'), async () => { await act('tournament_leave'); await loadTour(); rerender(); toast('Visszaléptél.'); });
}
async function drawNow() {
  await busy($app.querySelector('[data-ar-draw]'), async () => { await act('tournament_draw'); await loadTour(); drawAnim(); });
}
function cancelCup() {
  modal({
    title: 'Törlöd a kupát?', danger: true, okText: 'Törlés',
    text: T.status === 'reg' ? 'A jelentkezések elvesznek, a kupa elmarad.' : 'A kupa megszakad. A már lejátszott meccsek és az ELO-pontok megmaradnak.',
    onOk: async () => { await act('tournament_cancel'); await loadTour(); setTimeout(() => { rerender(); toast('A kupa törölve.'); }, 0); },
  });
}
// kupa kezelése: a kiíró a határidő után, az admin bármikor továbbléptethet; az admin törölhet is
function openManage() {
  const admin = state.me.is_admin;
  const open = T.games.filter((g) => g.a && g.b && !g.w).sort(order);
  const waited = (g) => { const h = Math.floor((Date.now() - Date.parse(g.ready)) / 3600000); return h >= 1 ? `${h} órája vár` : 'most indult'; };
  modal({
    title: '🛠 Kupa kezelése',
    text: `Ha egy meccs nem tud létrejönni, a játékosok egyike meccs nélkül (ELO nélkül) továbbjuttatható. ${admin ? '' : `Ezt ${T.hours} óra várakozás után teheted meg.`}`,
    body: `<div class="mg-list">${open.map((g) => { const ok = admin || overdue(g); return `
      <div class="mg-row"><div class="mg-h"><b>${isFinal(g) ? 'Döntő' : g.r < 0 ? 'Bronzmeccs' : roundName(g.r)}</b><small>${waited(g)}</small></div>
        <div class="mg-btns">${[g.a, g.b].map((id) => `<button type="button" class="chip" data-wo="${g.r}:${g.i}:${id}" ${ok ? '' : 'disabled'}>${esc(nameOf(id))} tovább</button>`).join('')}</div></div>`; }).join('') || '<p class="ar-note">Most nincs eredményre váró meccs.</p>'}</div>
      ${admin ? '<button type="button" class="btn block danger" data-mg-cancel style="margin-top:12px">A kupa törlése</button>' : ''}`,
  });
  $modal.querySelectorAll('[data-wo]').forEach((b) => { b.onclick = () => busy(b, async () => {
    const [r, i, id] = b.dataset.wo.split(':');
    await act('tournament_walkover', { p_round: +r, p_slot: +i, p_winner: id });
    await loadTour(); $modal.hidden = true;
    if (isFinal({ r: +r })) celebrate(id); else { rerender(); afterRecord({ r: +r, i: +i }, id); }
  }); });
  $modal.querySelector('[data-mg-cancel]')?.addEventListener('click', cancelCup);
}

// eredmény rögzítése: a szokásos meccsrögzítő, a két játékossal kitöltve (a kupameccs-kapcsoló magától bekapcsol)
function goRecord(g) {
  const sides = g.b === me() ? [[g.b], [g.a]] : [[g.a], [g.b]];
  state.prefill = { kind: 'singles', sides }; state.newKind = 'singles';
  location.hash = '#/uj';
}

// sorsolás: függöny, a nevek kártyákon, majd a hídon a helyükre repülnek
function drawAnim() {
  syncT();
  const names = T.entries.map((id) => `<span class="cu-card" data-pid="${id}" style="--d:${(Math.random() * 0.6).toFixed(2)}s;--x:${(Math.random() * 200 - 100).toFixed(0)}px;--y:${(Math.random() * 160 - 80).toFixed(0)}px;--r:${(Math.random() * 40 - 20).toFixed(0)}deg">${esc(nameOf(id))}</span>`).join('');
  curtain(`<div class="cu-title">Sorsolás</div><div class="cu-cards">${names}</div>`, () => {
    const from = [...document.querySelectorAll('.curtain .cu-card')].map((c) => ({ id: c.dataset.pid, r: c.getBoundingClientRect(), t: c.textContent }));
    window.scrollTo(0, 0); rerender();
    $app.querySelectorAll('.bn').forEach((x, k) => { x.style.animationDelay = `${200 + k * 60}ms`; x.classList.add('drop'); });
    from.forEach((f, k) => {
      const t = $app.querySelector(`.bn [data-pid="${f.id}"]`); if (!t) return;
      t.classList.add('await'); const tr = t.getBoundingClientRect();
      const fl = document.createElement('span'); fl.className = 'fly-card'; fl.textContent = f.t;
      fl.style.left = f.r.left + 'px'; fl.style.top = f.r.top + 'px'; document.body.appendChild(fl);
      fl.animate([{ transform: 'none' }, { transform: `translate(${tr.left - f.r.left}px, ${tr.top - f.r.top - 4}px) scale(.78)`, opacity: 0.85 }],
        { duration: 950, delay: 350 + k * 110, easing: 'cubic-bezier(.5,0,.25,1)', fill: 'forwards' })
        .onfinish = () => { fl.remove(); t.classList.remove('await'); t.classList.add('landed'); };
    });
  }, 1900);
}
// eredmény után: a lánc aranyban felizzik a következő pillérig, a híd odagördül
function afterRecord(g, w) {
  $app.querySelector(`.bn[data-g="${g.r}:${g.i}"]`)?.classList.add('flash');
  $app.querySelector(`.ch-glow[data-c="${g.r}:${g.i}"]`)?.classList.add('ignite');
  setTimeout(() => fitBridge(true), 900);
  toast(g.r === -1 ? `${nameOf(w)} bronzérmes! 🥉` : `${nameOf(w)} továbbjutott! 🏆`, 'ok');
}
function celebrate(w) {
  curtain(`<div class="cu-title">A Lánchíd Kupa bajnoka</div><div class="cu-champ">${esc(nameOf(w))}</div>`, () => {
    rerender(); goldDust();
    loadArchive().catch(() => {});
  }, 1700);
}

// Élő frissítés: valaki más nevezett, sorsolt vagy eredményt rögzített, miközben a Kupa fül nyitva van
export function arenaLive(prev) {
  if (!onKupa() || !$modal.hidden || document.querySelector('.curtain, .burn')) return;
  const cur = state.tour.cup;
  if (prev?.id === cur?.id && prev?.status === 'reg' && cur?.status === 'running') { drawAnim(); return; }
  if (prev?.id === cur?.id && prev?.status === 'running' && cur?.status === 'done') { celebrate(cur.champion); return; }
  const y = window.scrollY; rerender(); window.scrollTo(0, y);
  if (cur?.status === 'reg' && prev?.id === cur.id) {
    const fresh = cur.entries.map((e) => e.p).filter((id) => !prev.entries.some((e) => e.p === id));
    fresh.forEach((id) => stampAnim(T.entries.indexOf(id)));
  }
  if (cur?.status === 'running' && prev?.id === cur.id) {
    const done = cur.games.find((g) => g.w && !prev.games.some((x) => x.r === g.r && x.i === g.i && x.w));
    if (done) afterRecord(done, done.w);
  }
}

export function syncPlus() {
  const t = document.getElementById('ar-plus-tx'); if (t) t.textContent = plusLabel();
}

let dlTimer = 0;
export function bindArena(sub) {
  syncT(); syncPlus();
  $app.querySelector('[data-ar-new]')?.addEventListener('click', openCreate);
  $app.querySelector('[data-ar-special]')?.addEventListener('click', () => modal({
    title: '✉️ Egyedi bajnokság',
    text: 'Karácsonyi, majálisos vagy bármilyen különleges kupát (más témával, csoportkörrel, párosokkal) Balázs tud indítani. Beszélj vele, és ő összerakja nektek!',
  }));
  $app.querySelector('[data-ar-join]')?.addEventListener('click', join);
  $app.querySelector('[data-ar-leave]')?.addEventListener('click', leave);
  $app.querySelector('[data-ar-draw]')?.addEventListener('click', drawNow);
  $app.querySelector('[data-ar-cancel]')?.addEventListener('click', cancelCup);
  $app.querySelector('[data-ar-manage]')?.addEventListener('click', openManage);
  $app.querySelector('[data-ar-rec]')?.addEventListener('click', (e) => { const [r, i] = e.currentTarget.dataset.arRec.split(':').map(Number); goRecord(gameAt(r, i)); });
  $app.querySelector('[data-ar-bracket]')?.addEventListener('click', () => { $app.innerHTML = bracketView(); bindArena(); });
  if ($app.querySelector('.br-wrap')) requestAnimationFrame(() => fitBridge(false));
  $app.querySelectorAll('[data-cup]').forEach((b) => b.addEventListener('click', () => { openCup = b.dataset.cup; showBridge = false; rerenderSub('hirlap'); window.scrollTo(0, 0); }));
  $app.querySelector('[data-hl-back]')?.addEventListener('click', () => { openCup = null; rerenderSub('hirlap'); });
  $app.querySelector('[data-hl-bridge]')?.addEventListener('click', () => { showBridge = !showBridge; rerenderSub('hirlap'); if (showBridge) setTimeout(() => $app.querySelector('.br-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); });
  const fresh = $app.querySelector('.portrait.pending'); if (fresh) burnIn(fresh);
  const pl = $app.querySelector('.proc-left'); if (pl) pl.textContent = left(T.deadline);
  // a jelentkezési határidő lejártakor az adatbázis sorsol (vagy a kupa elmarad); ekkor frissítünk
  clearTimeout(dlTimer);
  if (T.status === 'reg' && !sub) {
    dlTimer = setTimeout(async () => { const prev = state.tour.cup; if (await loadTour()) arenaLive(prev); }, Math.min(2 ** 30, Math.max(0, T.deadline - Date.now()) + 1500));
  }
  // a lezárt kupák (Csarnok, Hírlap) a háttérben frissülnek
  if (sub === 'csarnok' || sub === 'hirlap') loadArchive().then((ch) => { if (ch && location.hash.endsWith(sub) && $modal.hidden && !document.querySelector('.burn')) rerenderSub(sub); }).catch(() => {});
  // épp rögzített kupameccs (a meccsrögzítőről jövünk vissza)
  const after = state.tourAfter; state.tourAfter = null;
  if (after && !sub && T.status !== 'none') {
    if (after.final) celebrate(after.w);
    else setTimeout(() => afterRecord({ r: after.round, i: after.slot }, after.w), 300);
  }
}
