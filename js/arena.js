// SZISZpong · Bajnokság: külön "festmény" világ (Schoefft József Széchenyi-portréja alapján)
import { $app } from './core.js';

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

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const THEME = { on: '#0e1730', off: '#0b0b12' };

function setTheme(on) {
  document.body.classList.toggle('arena', on);
  document.documentElement.classList.toggle('arena', on);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? THEME.on : THEME.off);
  const btn = document.getElementById('arena-btn');
  if (btn) btn.setAttribute('href', on ? '#/' : '#/bajnoksag');
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

export function renderArena() {
  const a = EMPTY_ART; const s = a.sign;
  $app.innerHTML = `
    <section class="ar">
      <header class="ar-head">
        <div class="ar-orn" aria-hidden="true"><i></i>✦<i></i></div>
        <h1 class="ar-title">Bajnokság</h1>
        <p class="ar-sub">A KGY-terem nagy tornái</p>
      </header>
      <figure class="${a.framed ? 'ar-frame' : 'ar-stage'}">
        <div class="ar-canvas" style="aspect-ratio:${a.ratio};--sx:${s.x}%;--sy:${s.y}%;--sw:${s.w}%;--sh:${s.h}%;--sr:${s.rot}deg;--fs:${s.size}cqw">
          <img src="${a.src}" alt="Széchenyi István sportruhában egy nagy üres képkeretnek támaszkodik" decoding="async">
          <div class="ar-sign ${a.placeholder ? 'ph' : ''}"><span>${a.text}</span></div>
          ${a.placeholder ? '<small class="ar-ph">helyőrző kép</small>' : ''}
        </div>
      </figure>
      <p class="ar-note">Ha kiírnak egy bajnokságot, itt jelenik meg a jelentkezés, a párosítás és az ágrajz.</p>
      <div class="ar-orn small" aria-hidden="true"><i></i>❦<i></i></div>
    </section>`;
}
