// SZISZpong · Bajnokság fül nézetei: üres állapot, kiáltvány, sorsolás, Lánchíd-ágrajz, bajnok, Arcképcsarnok, Kupák, Szabályok
// ELŐNÉZET: a kupa adatai most csak a böngészőben élnek (bemutató), az adatbázis a következő lépésben jön.
import { $app, esc, modal, nameOf, playerById, state, toast } from './core.js';
import { EMPTY_ART } from './arena.js';

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

// sorsolás: a két legerősebb az ágrajz két végére, a többi véletlen; üres hely = erőnyerő a legerősebbeknek
function draw() {
  const byElo = [...T.entries].sort((a, b) => (playerById(b)?.elo || 0) - (playerById(a)?.elo || 0));
  const seeds = byElo.slice(0, 2); const rest = byElo.slice(2).sort(() => Math.random() - 0.5);
  const slots = Array(T.size).fill(null);
  slots[0] = seeds[0]; slots[T.size - 1] = seeds[1] || null;
  const byes = T.size - T.entries.length;
  // az erőnyerők a legerősebbek ellenfél-helyei
  const byeSlots = [1, T.size - 2, 3, T.size - 4, 5, T.size - 6].slice(0, byes);
  let k = 0;
  for (let i = 0; i < T.size; i++) if (slots[i] == null && !byeSlots.includes(i)) slots[i] = rest[k++] || null;
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
function szechenyi(text) {
  const a = EMPTY_ART; const s = a.sign;
  return `
    <figure class="ar-stage">
      <div class="ar-canvas" style="aspect-ratio:${a.ratio};--sx:${s.x}%;--sy:${s.y}%;--sw:${s.w}%;--sh:${s.h}%;--sr:${s.rot}deg;--fs:${s.size}cqw">
        <img src="${a.src}" alt="Széchenyi István sportruhában egy nagy képkeretnek támaszkodik" decoding="async">
        <div class="ar-sign"><span>${text}</span></div>
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
      <div class="proc">
        <div class="proc-top">KIÁLTVÁNY</div>
        <p class="proc-lead">Lánchíd Kupát hirdet <b>${esc(nameOf(T.by))}</b>.<br>${T.size} hely · egyenes kieséses${T.bronze ? ' · bronzmeccs' : ''} · a döntő 2x pontot ér</p>
        ${T.msg ? `<p class="proc-msg">„${esc(T.msg)}”</p>` : ''}
        <div class="proc-dl">Jelentkezés még <b class="proc-left">${left(T.deadline)}</b></div>
        <div class="proc-slots s${T.size}">
          ${slots.map((id, i) => `<div class="medal ${id ? 'on' : ''}" data-slot="${i}"><span>${id ? esc(nameOf(id)) : 'szabad'}</span></div>`).join('')}
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

function medal(g, cls = '') {
  const side = (id, sc) => `<div class="mg-p ${g.w ? (g.w === id ? 'mw' : 'ml') : ''}"><span>${nm(id, g)}</span>${sc != null ? `<b>${sc}</b>` : ''}</div>`;
  const nx = nextGame();
  return `<div class="mg ${cls} ${nx === g ? 'next' : ''} ${g.w ? 'done' : ''}" data-g="${g.r}:${g.i}">${side(g.a, g.sa)}${side(g.b, g.sb)}</div>`;
}

function bracketView() {
  const R = rounds(); const fin = gameAt(R - 1, 0); const nx = nextGame();
  const rows = [];
  for (let r = R - 2; r >= 0; r--) {
    const gs = T.games.filter((g) => g.r === r);
    rows.push(`<div class="br-round"><div class="br-label">${roundName(r)}</div><div class="br-row n${gs.length}">${gs.map((g) => medal(g)).join('')}</div></div>`);
  }
  const br = gameAt(-1, 0);
  return `
    <section class="ar">
      ${head('Lánchíd Kupa', `${T.size} fő · ${roman(new Date().getFullYear())}`)}
      ${nx ? `<div class="br-next"><small>${isFinal(nx) ? '⚔️ A DÖNTŐ · 2x pont' : nx.r === -1 ? 'Bronzmeccs' : 'Következő meccs · ' + roundName(nx.r)}</small><b>${nm(nx.a)} <i>vs</i> ${nm(nx.b)}</b>
        <button type="button" class="btn ar-gold sm" data-ar-rec="${nx.r}:${nx.i}">Eredmény rögzítése</button></div>` : ''}
      <div class="bridge">
        <svg viewBox="0 0 360 150" class="bridge-svg" aria-hidden="true">
          <defs><linearGradient id="gd" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f6dd8c"/><stop offset="1" stop-color="#9c7424"/></linearGradient></defs>
          <path d="M20 112 H340" stroke="url(#gd)" stroke-width="5" fill="none"/>
          <path d="M20 120 H340" stroke="#6b4a10" stroke-width="2" fill="none" opacity=".7"/>
          <g fill="#1b2a50" stroke="url(#gd)" stroke-width="2">
            <path d="M52 140 V36 h36 V140 M62 140 V70 a8 8 0 0 1 16 0 V140"/>
            <path d="M272 140 V36 h36 V140 M282 140 V70 a8 8 0 0 1 16 0 V140"/>
          </g>
          <g stroke="url(#gd)" stroke-width="2.4" fill="none" class="chain">
            <path d="M70 38 Q180 128 290 38"/><path d="M70 38 Q35 80 4 104"/><path d="M290 38 Q325 80 356 104"/>
          </g>
          <g stroke="#e5c46a" stroke-width="1" opacity=".55">${[100, 125, 150, 175, 200, 225, 250].map((x) => { const t = (x - 70) / 220; const y = (1 - t) * (1 - t) * 38 + 2 * (1 - t) * t * 128 + t * t * 38; return `<path d="M${x} ${y.toFixed(1)} V110"/>`; }).join('')}</g>
        </svg>
        <span class="lion l" aria-hidden="true">🦁</span><span class="lion r" aria-hidden="true">🦁</span>
        <div class="br-final"><div class="br-label">Döntő · 2x</div>${medal(fin, 'final')}</div>
      </div>
      <div class="br-tree">${rows.join('')}</div>
      ${br ? `<div class="br-round bronze"><div class="br-label">Bronzmeccs</div><div class="br-row n1">${medal(br)}</div></div>` : ''}
      ${orn}
    </section>`;
}

function championView() {
  const c = T.champion; const fin = gameAt(rounds() - 1, 0);
  return `
    <section class="ar champ">
      ${head('Lánchíd Kupa', 'Bajnokunk')}
      <div class="champ-name">${esc(nameOf(c))}</div>
      <div class="champ-sub">A döntőben: ${esc(nameOf(fin.a))} – ${esc(nameOf(fin.b))} ${fin.sa}:${fin.sb}</div>
      ${szechenyi(`Bajnok:<br>${esc(nameOf(c))}`)}
      <div class="ar-cta">
        <a class="btn block ar-ghost" href="#/bajnoksag/csarnok">🖼 Arcképcsarnok</a>
        <button type="button" class="btn block ar-ghost" data-ar-bracket>Az ágrajz megtekintése</button>
      </div>
      ${orn}
    </section>`;
}

function hallView() {
  const list = [...HALL].reverse();
  const initials = (n) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return `
    <section class="ar">
      ${head('Arcképcsarnok', 'A Lánchíd Kupa bajnokai')}
      <div class="hall">
        ${list.map((h, k) => `
          <figure class="portrait" style="animation-delay:${k * 90}ms">
            <div class="pf"><div class="pc"><span>${esc(initials(h.name))}</span></div></div>
            <figcaption class="plate"><b>${esc(h.name)}</b><small>${romanDate(h.at)} · ${h.size} fő</small></figcaption>
          </figure>`).join('')}
      </div>
      <p class="ar-note">Minden bajnok ide kerül, aranykeretben, örök dicsőségben.</p>
      ${orn}
    </section>`;
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

function stampAnim(slot) {
  const seal = $app.querySelector('.seal'); const m = $app.querySelector(`.medal[data-slot="${slot}"]`);
  seal?.classList.remove('stamp'); void seal?.offsetWidth; seal?.classList.add('stamp');
  m?.classList.add('engrave');
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
  const names = T.entries.map((id) => `<span class="cu-card" style="--d:${(Math.random() * 0.6).toFixed(2)}s;--x:${(Math.random() * 200 - 100).toFixed(0)}px;--y:${(Math.random() * 160 - 80).toFixed(0)}px;--r:${(Math.random() * 40 - 20).toFixed(0)}deg">${esc(nameOf(id))}</span>`).join('');
  curtain(`<div class="cu-title">Sorsolás</div><div class="cu-cards">${names}</div>`, () => { draw(); rerender(); $app.querySelectorAll('.mg').forEach((x, k) => { x.style.animationDelay = `${300 + k * 70}ms`; x.classList.add('drop'); }); syncPlus(); }, 1900);
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
        if (final) { celebrate(w); return; }
        rerender(); syncPlus();
        const el = $app.querySelector(`[data-g="${g.r}:${g.i}"]`); el?.classList.add('flash');
        toast(`${nameOf(w)} továbbjutott! 🏆`, 'ok');
      }, 0);
    },
  });
  document.querySelector('#modal-form [type=submit]')?.classList.add('ar-gold');
}
export function recordDemo(r, i, a, b) { const g = gameAt(r, i); if (!g) return; const fin = isFinal(g); const w = record(g, a, b); if (fin) celebrate(w); else { rerender(); syncPlus(); } }
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
  $app.querySelector('[data-ar-bracket]')?.addEventListener('click', () => { $app.innerHTML = bracketView(); });
  const pl = $app.querySelector('.proc-left'); if (pl) pl.textContent = left(T.deadline);
}

// csak az előnézethez: a videó-szkript ezekkel tölti fel a kupát
document.getElementById('ar-plus')?.addEventListener('click', () => plusAction());
window.__arenaDemo = { T, join, startDraw, recordDemo, plusAction, ids: () => state.players.filter((p) => p.active).map((p) => p.id) };
