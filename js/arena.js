// SZISZpong · Bajnokság: külön "festmény" világ (Schoefft József Széchenyi-portréja alapján)
import { $app, state } from './core.js';

// A Bajnokság fül nehezebb része (nézetek, ágrajz, Hírlap) csak az első megnyitáskor töltődik le
let views = null;
const loadViews = () => (views ||= import('./arena-views.js'));

/* A "nincs bajnokság" kép: Széchenyi kivágva (átlátszó háttérrel), egy nagy képkeretnek támaszkodva.
   Új kép esetén: cseréld le a fájlt, és a sign értékeit (százalékban, a képhez mérten) igazítsd a keret belsejéhez.
   framed: true = a kép egy aranykeretes festményként jelenik meg (nem kivágott képhez). */
export const EMPTY_ART = {
  src: 'img/bajnoksag-ures.webp',
  ratio: '760 / 1016',        // a kép oldalaránya (szélesség / magasság)
  framed: false,
  placeholder: false,
  // a keret belseje: közepe (x, y), szélessége, magassága, dőlése fokban; size = betűméret a kép szélességéhez mérten
  sign: { x: 70.6, y: 59.8, w: 36.9, h: 51.9, rot: 0, size: 7.6 },
  text: 'Jelenleg<br>nincs<br>bajnokság',
};

/* Változó Széchenyik: minden állapotnak saját képe lehet, ugyanebben a formában (src, ratio, sign).
   Ha egy állapothoz még nincs kép (null), a fenti "nincs bajnokság" kép ugrik be helyette.
   reg = jelentkezés (toboroz), running = zajlik (játszik), done = vége (kupát emel).
   Később a témás kupák (karácsony, majális…) a saját képeiket a téma-csomagból adják. */
export const ARTS = {
  none: EMPTY_ART,
  reg: { src: 'img/bajnoksag-reg.webp', ratio: '760 / 1056', sign: { x: 70.7, y: 60.3, w: 35.2, h: 51.6, rot: 0, size: 7.2 } },
  running: { src: 'img/bajnoksag-running.webp', ratio: '760 / 1252', sign: null },
  done: { src: 'img/bajnoksag-done.webp', ratio: '760 / 1165', sign: { x: 71.0, y: 64.5, w: 32.6, h: 43.0, rot: 0, size: 6.8 } },
};
export const artFor = (key) => ARTS[key] || ARTS.none;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const THEME = { on: '#0e1730', off: '#0b0b12' };

function setTheme(on) {
  document.body.classList.toggle('arena', on);
  document.documentElement.classList.toggle('arena', on);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? THEME.on : THEME.off);
  const btn = document.getElementById('arena-btn');
  if (btn) btn.setAttribute('href', on ? '#/' : '#/bajnoksag');
  ambience(on);
}

/* Hangulat: lassan szálló aranyporszemek a felhők előtt, és ritkán egy halk villám a viharos égen */
let boltTimer = 0;
function ambience(on) {
  const sky = document.querySelector('.sky'); if (!sky) return;
  clearTimeout(boltTimer);
  if (!on || reduced()) return;
  if (!sky.querySelector('.motes')) {
    const m = document.createElement('div'); m.className = 'motes';
    for (let i = 0; i < 26; i++) {
      const b = document.createElement('b'); const r = Math.random;
      b.style.cssText = `left:${(r() * 100).toFixed(1)}%;top:${(25 + r() * 75).toFixed(1)}%;--t:${(14 + r() * 16).toFixed(1)}s;--d:-${(r() * 30).toFixed(1)}s;--dx:${(r() * 80 - 40).toFixed(0)}px;--o:${(0.35 + r() * 0.55).toFixed(2)};--s:${(0.5 + r() * 1.1).toFixed(2)}`;
      m.appendChild(b);
    }
    const bolt = document.createElement('div'); bolt.className = 'bolt';
    sky.append(m, bolt);
  }
  const next = () => { boltTimer = setTimeout(() => { strike(); next(); }, 14000 + Math.random() * 18000); };
  next();
}
export function strike() {
  const bolt = document.querySelector('.sky .bolt'); if (!bolt || !document.documentElement.classList.contains('arena')) return;
  const x = 10 + Math.random() * 80; let y = 0; let px = x * 4; const pts = [`${px.toFixed(0)},0`];
  while (y < 180) { y += 14 + Math.random() * 22; px += Math.random() * 44 - 22; pts.push(`${px.toFixed(0)},${y.toFixed(0)}`); }
  bolt.style.setProperty('--lx', x + '%');
  bolt.innerHTML = `<svg viewBox="0 0 400 400" preserveAspectRatio="none"><polyline points="${pts.join(' ')}"/></svg>`;
  bolt.classList.remove('strike'); void bolt.offsetWidth; bolt.classList.add('strike');
}

// Átváltás: a SZISZpong felirat megfordul (hátoldalán a "fancy" változat),
// közben a fejléc alatt egy rövid, úszó olajfestmény-felhős töltőképernyő jelenik meg.
let busy = false;
export function arenaSwitch(on, render, { instant = false } = {}) {
  const html = document.documentElement;
  html.classList.toggle('arena-flip', on);
  if (instant || reduced() || busy) { setTheme(on); render(); return; }
  busy = true;
  const veil = document.createElement('div');
  veil.className = 'arena-veil';
  veil.style.top = (document.querySelector('.topbar')?.offsetHeight || 0) + 'px';
  veil.innerHTML = `<div class="vl-sky"><i></i><i></i></div>${on ? '<div class="vl-mark">BAJNOKSÁG<small>a KGY-terem nagy tornái</small></div>' : ''}`;
  document.body.appendChild(veil);
  requestAnimationFrame(() => requestAnimationFrame(() => veil.classList.add('show')));
  const swap = on ? 650 : 480; const hide = on ? 1350 : 900;
  setTimeout(() => { setTheme(on); render(); window.scrollTo(0, 0); }, swap);
  setTimeout(() => veil.classList.add('hide'), hide);
  setTimeout(() => { veil.remove(); busy = false; }, hide + 600);
}

export async function renderArena(sub) {
  document.querySelectorAll('#nav-arena [data-ar]').forEach((a) => a.classList.toggle('active', a.dataset.ar === (sub || 'kupa')));
  if (!views) $app.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const v = await loadViews();
  if (state.view !== 'arena' || (location.hash.split('/')[2] || undefined) !== sub) return;   // közben máshová léptünk
  $app.innerHTML = v.arenaView(sub);
  v.bindArena(sub);
}

// élő frissítés a kupáról: csak akkor kell a nézet, ha a Bajnokság fül nyitva van
export function arenaLive(prev) {
  if (state.view === 'arena' && views) loadViews().then((v) => v.arenaLive(prev));
}

// a Bajnokság menü középső gombja (kiírás / jelentkezés / rögzítés)
document.getElementById('ar-plus')?.addEventListener('click', () => loadViews().then((v) => v.plusAction()));
