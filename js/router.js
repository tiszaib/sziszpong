// SZISZpong · Útválasztás: melyik képernyő jelenjen meg
import { renderAdmin } from './admin.js';
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
export function route() {
  charts.forEach((c) => c.destroy()); charts.length = 0;
  closeModal();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!state.me) { $nav.hidden = true; state.view = 'auth'; renderAuth(); return; }
  $nav.hidden = false;
  const page = parts[0] || '';
  if (page === 'paros') { state.view = 'doubles'; renderRanking('doubles'); }
  else if (page === 'meccsek') { state.view = 'matches'; renderMatches(); }
  else if (page === 'uj') { state.view = 'new'; renderNewMatch(); }
  else if (page === 'profil') { state.view = 'profile'; renderProfile(parts[1] || state.me.id); }
  else if (page === 'statok') { state.view = 'stats'; renderMyStats(); }
  else if (page === 'admin' && state.me.is_admin) { state.view = 'admin'; renderAdmin(); }
  else { state.view = 'singles'; renderRanking('singles'); }
  const navKey = ['admin', 'stats'].includes(state.view) ? 'profile' : state.view;
  $nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
  setTimeout(checkNewAchievements, 0);
}

export function rerenderIfLive() {
  if (['singles', 'doubles', 'matches', 'profile', 'stats'].includes(state.view) && $modal.hidden) {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
}
