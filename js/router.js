// SZISZpong · Útválasztás: melyik képernyő jelenjen meg
import { renderAchievements } from './achievements.js';
import { renderAdmin } from './admin.js';
import { arenaSwitch, renderArena } from './arena.js';
import { renderAuth } from './auth.js';
import { $modal, $nav, charts, closeModal, state } from './core.js';
import { checkNewAchievements } from './honors-ui.js';
import { renderMatches } from './matches.js';
import { renderMyStats } from './mystats.js';
import { renderNewMatch } from './newmatch.js';
import { renderProfile } from './profile.js';
import { renderRanking } from './ranking.js';

/* ------------------------------------------------------------------
   3. Képernyők
   ------------------------------------------------------------------ */
let routed = false;   // az első megjelenítésnél nincs áttűnés
export function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // Bajnokság: belépéskor és kilépéskor áttűnés a festmény-világba
  const toArena = !!state.me && parts[0] === 'bajnoksag';
  if (toArena !== document.body.classList.contains('arena')) {
    const first = !routed;
    arenaSwitch(toArena, route, { instant: first || !state.me });
    return;
  }
  routed = true;
  charts.forEach((c) => c.destroy()); charts.length = 0;
  closeModal();
  const ab = document.getElementById('arena-btn');
  if (!state.me) { $nav.hidden = true; ab.hidden = true; state.view = 'auth'; renderAuth(); return; }
  $nav.hidden = false; ab.hidden = false;
  const page = parts[0] || '';
  if (page === 'paros') { state.view = 'doubles'; renderRanking('doubles'); }
  else if (page === 'meccsek') { state.view = 'matches'; renderMatches(); }
  else if (page === 'uj') { state.view = 'new'; renderNewMatch(); }
  else if (page === 'profil') { state.view = 'profile'; renderProfile(parts[1] || state.me.id); }
  else if (page === 'statok') { state.view = 'stats'; renderMyStats(); }
  else if (page === 'bajnoksag') { state.view = 'arena'; renderArena(parts[1]); }
  else if (page === 'achi') { state.view = 'achi'; renderAchievements(parts[1] || state.me.id); }
  else if (page === 'admin' && state.me.is_admin) { state.view = 'admin'; renderAdmin(); }
  else { state.view = 'singles'; renderRanking('singles'); }
  const navKey = ['admin', 'stats', 'achi'].includes(state.view) ? 'profile' : state.view;
  $nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
  setTimeout(checkNewAchievements, 0);
}

export function rerenderIfLive() {
  if (['singles', 'doubles', 'matches', 'profile', 'stats', 'achi'].includes(state.view) && $modal.hidden) {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
}
