// SZISZpong · Bajnokság fül nézetei: üres állapot, kiáltvány, sorsolás, Lánchíd-ágrajz, bajnok, Arcképcsarnok, Kupák, Szabályok
// ELŐNÉZET: a kupa adatai most csak a böngészőben élnek (bemutató), az adatbázis a következő lépésben jön.
import { $app, esc, modal, nameOf, playerById, state, toast } from './core.js';
import { EMPTY_ART, artFor, strike } from './arena.js';

/* ---------------- bemutató adatok ---------------- */
const DAY = 86400000;
export const T = {
  status: 'none',      // none | reg | running | done
  size: 8, bronze: true, msg: '', by: null, deadline: 0,
  entries: [],         // játékos id-k a jelentkezés sorrendjében
  games: [],           // { r, i, a, b, w, sa, sb }  r: forduló (0 = első), i: sorszám; bronz: r = -1
  champion: null, finishedAt: 0,
};
const HALL = [   // korábbi bajnokok (bemutató)
  { name: 'Peti', at: '2026-10-18', size: 8 },
  { name: 'Kata', at: '2026-11-08', size: 4 },
];

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
const romanDate = (d) => { d = new Date(d); return `${roman(d.getFullYear())}. ${roman(d.getMonth() + 1)}. ${d.getDate()}.`; };
const rounds = () => Math.log2(T.size);
const roundName = (r) => { const k = rounds() - 1 - r; return k === 0 ? 'Döntő' : k === 1 ? 'Elődöntő' : k === 2 ? 'Negyeddöntő' : `${roman(r + 1)}. forduló`; };
const nm = (id, g) => (id ? esc(nameOf(id)) : g && g.r === 0 ? '<i>erőnyerő</i>' : '<i>?</i>');
const me = () => state.me?.id;
const gameAt = (r, i) => T.games.find((g) => g.r === r && g.i === i);
const nextGame = () => T.games.filter((g) => g.a && g.b && !g.w).sort((x, y) => (x.r === -1) - (y.r === -1) || x.r - y.r || x.i - y.i)[0];
const isFinal = (g) => g.r === rounds() - 1;
const left = (d) => { const ms = Math.max(0, d - Date.now()); const h = Math.floor(ms / 3600000); return h >= 24 ? `${Math.floor(h / 24)} nap ${h % 24} ó` : `${h} ó ${Math.floor((ms % 3600000) / 60000)} p`; };

// sorsolás: a két legerősebb az ágrajz két végére, a többi véletlen.
// Ha nem telt be, a legerősebbek kapnak erőnyerőt, és egy párharcban sosem lesz két üres hely.
function draw() {
  const n = T.entries.length;
  T.size = Math.max(4, 2 ** Math.ceil(Math.log2(n)));   // ha kevesen jöttek, kisebb ágrajz
  const byElo = [...T.entries].sort((a, b) => (playerById(b)?.elo || 0) - (playerById(a)?.elo || 0));
  const g0 = T.size / 2; const byes = T.size - n;
  const order = Array.from({ length: g0 }, (_, k) => (k % 2 ? g0 - 1 - (k >> 1) : k >> 1));   // felváltva a két végről befelé
  const outer = (k) => (k % 2 ? 2 * order[k] + 1 : 2 * order[k]);
  const slots = Array(T.size).fill(undefined);
  const seeded = Math.max(2, byes);
  for (let k = 0; k < seeded && k < n; k++) { slots[outer(k)] = byElo[k]; if (k < byes) slots[outer(k) ^ 1] = null; }
  const rest = byElo.slice(seeded).sort(() => Math.random() - 0.5);
  for (let i = 0, q = 0; i < T.size; i++) if (slots[i] === undefined) slots[i] = rest[q++] ?? null;
  T.games = [];
  for (let r = 0; r < rounds(); r++) for (let i = 0; i < T.size >> (r + 1); i++) T.games.push({ r, i, a: r ? null : slots[2 * i], b: r ? null : slots[2 * i + 1], w: null });
  if (T.bronze && T.size >= 4) T.games.push({ r: -1, i: 0, a: null, b: null, w: null });
  T.games.filter((g) => g.r === 0 && (!g.a || !g.b)).forEach((g) => advance(g, g.a || g.b));
  T.status = 'running';
}
function advance(g, w, sa = null, sb = null) {
  g.w = w; g.sa = sa; g.sb = sb;
  if (g.r === -1) return;
  if (isFinal(g)) { T.champion = w; T.status = 'done'; T.finishedAt = Date.now(); return; }
  const nx = gameAt(g.r + 1, g.i >> 1);
  if (g.i % 2 === 0) nx.a = w; else nx.b = w;
  // az elődöntők vesztesei a bronzmeccsre
  if (g.r === rounds() - 2 && T.bronze) { const br = gameAt(-1, 0); const l = w === g.a ? g.b : g.a; if (g.i % 2 === 0) br.a = l; else br.b = l; }
}
// meccs rögzítése a bemutatóban (a döntő 2x)
function record(g, sa, sb) {
  const w = sa > sb ? g.a : g.b;
  advance(g, w, sa, sb);
  return w;
}

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
  if (sub === 'csarnok') return hallView();
  if (sub === 'ranglista') return cupsView();
  if (sub === 'szabalyok') return rulesView();
  if (T.status === 'reg') return procView();
  if (T.status === 'running') return bracketView();
  if (T.status === 'done') return championView();
  return emptyView();
}

function emptyView() {
  const last = HALL[HALL.length - 1];
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
        ${T.by === me() ? `<button type="button" class="btn block ar-ghost" data-ar-draw ${T.entries.length < 4 ? 'disabled' : ''}>🎭 Sorsolás most</button>` : ''}
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
  const side = (id, sc) => `<div class="bn-p ${!id && g.r === 0 ? 'bye' : g.w ? (g.w === id ? 'mw' : 'ml') : ''}"><span ${id ? `data-pid="${id}"` : ''}>${nm(id, g)}</span>${sc != null ? `<b>${sc}</b>` : ''}</div>`;
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
function bracketView() {
  const nx = nextGame();
  return `
    <section class="ar">
      ${head('Lánchíd Kupa', `${T.size} fő · ${roman(new Date().getFullYear())}`)}
      ${nx ? `<div class="br-next"><small>${isFinal(nx) ? '⚔️ A DÖNTŐ · 2x pont' : nx.r === -1 ? 'Bronzmeccs' : 'Következő meccs · ' + roundName(nx.r)}</small><b>${nm(nx.a)} <i>vs</i> ${nm(nx.b)}</b>
        <button type="button" class="btn ar-gold sm" data-ar-rec="${nx.r}:${nx.i}">Eredmény rögzítése</button></div>` : ''}
      ${bridgeHTML()}
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
  const nx = nextGame(); const el = $app.querySelector(nx ? `.bn[data-g="${nx.r}:${nx.i}"]` : '.bn.final');
  if (el) wrap.scrollTo({ left: (el.offsetLeft + el.offsetWidth / 2) * z - avail / 2, behavior: smooth ? 'smooth' : 'auto' });
}


function championView() {
  const c = T.champion; const fin = gameAt(rounds() - 1, 0);
  return `
    <section class="ar champ">
      ${head('Lánchíd Kupa', 'Bajnokunk')}
      <div class="champ-name">${esc(nameOf(c))}</div>
      <div class="champ-sub">A döntőben: ${esc(nameOf(fin.a))} – ${esc(nameOf(fin.b))} ${fin.sa}:${fin.sb}</div>
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
const hallKey = (h) => `${h.name}|${h.at}`;
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
  const list = [...HALL].reverse();
  return `
    <section class="ar">
      ${head('Arcképcsarnok', 'A Lánchíd Kupa bajnokai')}
      <div class="hall">${list.map((h, k) => portraitHTML(h, k, k === 0 && isFresh(h) ? 'pending' : '')).join('')}</div>
      <p class="ar-note">Minden bajnok ide kerül, aranykeretben, örök dicsőségben.</p>
      ${orn}
    </section>`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// a név és a dátum tüzesen beleég a réztáblába, majd a kép és a tábla leszáll a helyére
async function burnIn(fig) {
  const h = [...HALL].reverse()[0]; markSeen(h);
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


function cupsView() {
  const rows = {};
  for (const h of HALL) { rows[h.name] = rows[h.name] || { w: 0, f: 0 }; rows[h.name].w++; rows[h.name].f++; }
  const sample = { Balázs: { w: 0, f: 1 }, Dani: { w: 0, f: 1 } };
  for (const [k, v] of Object.entries(sample)) { rows[k] = rows[k] || { w: 0, f: 0 }; rows[k].f += v.f; }
  const list = Object.entries(rows).sort((a, b) => b[1].w - a[1].w || b[1].f - a[1].f);
  return `
    <section class="ar">
      ${head('Kupák', 'Ki emelte a legtöbbször a magasba?')}
      <div class="cups">
        <div class="cups-h"><span></span><span>Játékos</span><span>🏆</span><span>Döntő</span></div>
        ${list.map(([n, v], i) => `<div class="cups-r"><span class="cn">${roman(i + 1)}.</span><span>${esc(n)}</span><b>${v.w}</b><span>${v.f}</span></div>`).join('')}
      </div>
      <p class="ar-note">Összesen ${HALL.length} Lánchíd Kupa zajlott eddig.</p>
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
          <li>A jelentkezés a határidőig tart. Ha betelt, vagy a kiíró elindítja, <b>az app sorsol</b>.</li>
          <li>A két legerősebb az ágrajz két végére kerül. Ha nem telt be, a legerősebbek <b>erőnyerők</b>.</li>
          <li><b>Egyenes kieséses:</b> minden párharc egy meccs, a győztes továbbjut.</li>
          <li>Minden meccs számít az ELO-ba, <b>a döntő 2x pontot ér</b>.</li>
          <li>Fordulónként 3 nap van lejátszani a meccset.</li>
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

/* ---------------- műveletek ---------------- */
export function plusAction() {
  if (T.status === 'none' || T.status === 'done') return openCreate();
  if (T.status === 'reg') { if (T.entries.includes(me())) toast('Már jelentkeztél. ✍️'); else join(); return; }
  const nx = nextGame(); if (nx) openRecord(nx);
}
export function plusLabel() {
  return T.status === 'reg' ? (T.entries.includes(me()) ? 'Jelentkeztél' : 'Jelentkezem') : T.status === 'running' ? 'Rögzítés' : 'Kiírás';
}

function openCreate() {
  if (location.hash !== '#/bajnoksag') location.hash = '#/bajnoksag';
  modal({
    title: 'Lánchíd Kupa kiírása',
    text: 'Egyenes kieséses, a döntő 2x pontot ér.',
    body: `
      <div class="field"><span>Létszám</span><div class="chips ar-size">${[4, 8, 16].map((n) => `<button type="button" class="chip ${n === 8 ? 'active' : ''}" data-n="${n}">${n} fő</button>`).join('')}</div></div>
      <label class="field"><span>Jelentkezési határidő</span>
        <select class="select" name="dl"><option value="1">holnap ilyenkor</option><option value="2" selected>2 nap múlva</option><option value="3">3 nap múlva</option></select></label>
      <label class="ar-check"><input type="checkbox" name="bronze" checked> Bronzmeccs a 3. helyért</label>
      <label class="field"><span>Üzenet (nem kötelező)</span><input class="input" name="msg" maxlength="140" placeholder="pl. Péntek este 8-tól a teremben 🏓"></label>`,
    okText: 'Kiírom ⚔️',
    onOk: async (f) => {
      Object.assign(T, { status: 'reg', size: +(f.querySelector('.ar-size .active')?.dataset.n || 8), bronze: f.elements.bronze.checked,
        msg: f.elements.msg.value.trim(), by: me(), deadline: Date.now() + +f.elements.dl.value * DAY, entries: [me()], games: [], champion: null });
      setTimeout(() => { rerender(); stampAnim(0); syncPlus(); }, 0);
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
export function join(id = me()) {
  if (T.status !== 'reg' || T.entries.includes(id) || T.entries.length >= T.size) return;
  T.entries.push(id);
  if (location.hash.startsWith('#/bajnoksag') && !location.hash.slice(12)) { rerender(); stampAnim(T.entries.length - 1); }
  syncPlus();
  if (T.entries.length >= T.size) setTimeout(startDraw, 1400);
}
export function startDraw() {
  if (T.status !== 'reg') return;
  const names = T.entries.map((id) => `<span class="cu-card" data-pid="${id}" style="--d:${(Math.random() * 0.6).toFixed(2)}s;--x:${(Math.random() * 200 - 100).toFixed(0)}px;--y:${(Math.random() * 160 - 80).toFixed(0)}px;--r:${(Math.random() * 40 - 20).toFixed(0)}deg">${esc(nameOf(id))}</span>`).join('');
  curtain(`<div class="cu-title">Sorsolás</div><div class="cu-cards">${names}</div>`, () => {
    // a kártyák helyéről a nevek a hídra repülnek, a saját helyükre
    const from = [...document.querySelectorAll('.curtain .cu-card')].map((c) => ({ id: c.dataset.pid, r: c.getBoundingClientRect(), t: c.textContent }));
    draw(); window.scrollTo(0, 0); rerender(); syncPlus();
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
  rerender(); syncPlus();
  $app.querySelector(`.bn[data-g="${g.r}:${g.i}"]`)?.classList.add('flash');
  $app.querySelector(`.ch-glow[data-c="${g.r}:${g.i}"]`)?.classList.add('ignite');
  setTimeout(() => fitBridge(true), 900);
  toast(`${nameOf(w)} továbbjutott! 🏆`, 'ok');
}

function openRecord(g) {
  modal({
    title: isFinal(g) ? '⚔️ A döntő eredménye' : g.r < 0 ? 'Bronzmeccs' : roundName(g.r),
    text: isFinal(g) ? 'A döntő 2x pontot ér.' : '',
    body: `<div class="score-row ar-score"><label><span>${nm(g.a)}</span><input class="input score-in" name="a" type="number" inputmode="numeric" min="0" max="99" placeholder="–"></label><b>:</b><label><span>${nm(g.b)}</span><input class="input score-in" name="b" type="number" inputmode="numeric" min="0" max="99" placeholder="–"></label></div>`,
    okText: 'Rögzítés',
    onOk: async (f) => {
      const a = +f.elements.a.value; const b = +f.elements.b.value;
      if (f.elements.a.value === '' || f.elements.b.value === '' || a === b) throw new Error('Írd be mindkét pontszámot (döntetlen nem lehet).');
      const final = isFinal(g);
      const w = record(g, a, b);
      setTimeout(() => {
        if (final) celebrate(w); else afterRecord(g, w);
      }, 0);
    },
  });
  document.querySelector('#modal-form [type=submit]')?.classList.add('ar-gold');
}
export function recordDemo(r, i, a, b) { const g = gameAt(r, i); if (!g) return; const fin = isFinal(g); const w = record(g, a, b); if (fin) celebrate(w); else afterRecord(g, w); }
function celebrate(w) {
  curtain(`<div class="cu-title">A Lánchíd Kupa bajnoka</div><div class="cu-champ">${esc(nameOf(w))}</div>`, () => {
    HALL.push({ name: nameOf(w), at: new Date().toISOString().slice(0, 10), size: T.size });
    rerender(); syncPlus(); goldDust();
  }, 1700);
}

export function syncPlus() {
  const t = document.getElementById('ar-plus-tx'); if (t) t.textContent = plusLabel();
}

export function bindArena() {
  syncPlus();
  $app.querySelector('[data-ar-new]')?.addEventListener('click', openCreate);
  $app.querySelector('[data-ar-special]')?.addEventListener('click', () => modal({
    title: '✉️ Egyedi bajnokság',
    text: 'Karácsonyi, majálisos vagy bármilyen különleges kupát (más témával, csoportkörrel, párosokkal) Balázs tud indítani. Beszélj vele, és ő összerakja nektek!',
  }));
  $app.querySelector('[data-ar-join]')?.addEventListener('click', () => join());
  $app.querySelector('[data-ar-leave]')?.addEventListener('click', () => { T.entries = T.entries.filter((x) => x !== me()); if (!T.entries.length) T.status = 'none'; rerender(); syncPlus(); });
  $app.querySelector('[data-ar-draw]')?.addEventListener('click', startDraw);
  $app.querySelector('[data-ar-rec]')?.addEventListener('click', (e) => { const [r, i] = e.currentTarget.dataset.arRec.split(':').map(Number); openRecord(gameAt(r, i)); });
  $app.querySelector('[data-ar-bracket]')?.addEventListener('click', () => { $app.innerHTML = bracketView(); fitBridge(false); });
  if ($app.querySelector('.br-wrap')) requestAnimationFrame(() => fitBridge(false));
  const fresh = $app.querySelector('.portrait.pending'); if (fresh) burnIn(fresh);
  const pl = $app.querySelector('.proc-left'); if (pl) pl.textContent = left(T.deadline);
}

// csak az előnézethez: a videó-szkript ezekkel tölti fel a kupát
document.getElementById('ar-plus')?.addEventListener('click', () => plusAction());
window.__arenaDemo = { T, join, startDraw, recordDemo, plusAction, strike, ids: () => state.players.filter((p) => p.active).map((p) => p.id) };
