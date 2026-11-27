// SZISZpong · Bajnokság: külön "festmény" világ (Schoefft József Széchenyi-portréja alapján)
import { $app } from './core.js';

/* A "nincs bajnokság" kép. Ha megjön a végleges kép:
   1. cseréld le az img/bajnoksag-ures.jpg fájlt,
   2. placeholder: false,
   3. a sign értékeit (százalékban, a képhez mérten) igazítsd a táblához. */
export const EMPTY_ART = {
  src: 'img/bajnoksag-ures.jpg',
  ratio: '3 / 4',             // a kép oldalaránya (szélesség / magasság)
  placeholder: false,
  // a tábla belseje a képen, százalékban: közepe (x, y), szélessége, magassága, dőlése fokban; size = betűméret a kép szélességéhez mérten
  sign: { x: 72.5, y: 62.3, w: 34.5, h: 48.7, rot: 0, size: 7.2 },
  text: 'Jelenleg<br>nincs<br>bajnokság',
};

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const THEME = { on: '#0e1730', off: '#0b0b12' };

function setTheme(on) {
  document.body.classList.toggle('arena', on);
  document.documentElement.classList.toggle('arena', on);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? THEME.on : THEME.off);
}

// Áttűnés: belépéskor a festmény a Bajnokság gombból kör alakban szétterül, aranykeret rajzolódik,
// majd feltárul az oldal. Kilépéskor a festmény visszahúzódik a gombba.
let busy = false;
export function arenaSwitch(on, render, { instant = false } = {}) {
  if (instant || reduced() || busy) { setTheme(on); render(); return; }
  busy = true;
  const btn = document.querySelector('.nav-item[data-route="arena"]');
  const r = btn?.getBoundingClientRect();
  const x = r ? Math.round(r.left + r.width / 2) : innerWidth / 2;
  const y = r ? Math.round(r.top + r.height / 2) : innerHeight;
  const veil = document.createElement('div');
  veil.className = `arena-veil ${on ? 'in' : 'out'}`;
  veil.style.setProperty('--vx', x + 'px');
  veil.style.setProperty('--vy', y + 'px');
  veil.innerHTML = '<div class="veil-paint"></div><div class="veil-frame"></div>';
  document.body.appendChild(veil);
  const done = () => { veil.remove(); busy = false; };
  if (on) {
    // 1) festmény szétterül + keret (0–750 ms), 2) alatta átvált az oldal, 3) a fátyol elhalványul
    setTimeout(() => { setTheme(true); render(); window.scrollTo(0, 0); }, 760);
    setTimeout(() => veil.classList.add('fade'), 820);
    setTimeout(done, 1400);
  } else {
    // a festmény takar, alatta visszaáll a megszokott app, majd a festmény visszahúzódik a gombba
    setTimeout(() => { setTheme(false); render(); window.scrollTo(0, 0); veil.classList.add('shrink'); }, 220);
    setTimeout(done, 900);
  }
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
      <figure class="ar-frame">
        <div class="ar-canvas" style="aspect-ratio:${a.ratio};--sx:${s.x}%;--sy:${s.y}%;--sw:${s.w}%;--sh:${s.h}%;--sr:${s.rot}deg;--fs:${s.size}cqw">
          <img src="${a.src}" alt="Széchenyi István sportruhában egy üres keret mellett" decoding="async">
          <div class="ar-sign ${a.placeholder ? 'ph' : ''}"><span>${a.text}</span></div>
          ${a.placeholder ? '<small class="ar-ph">helyőrző kép</small>' : ''}
        </div>
      </figure>
      <p class="ar-note">Ha kiírnak egy bajnokságot, itt jelenik meg a jelentkezés, a párosítás és az ágrajz.</p>
      <div class="ar-orn small" aria-hidden="true"><i></i>❦<i></i></div>
    </section>`;
}
