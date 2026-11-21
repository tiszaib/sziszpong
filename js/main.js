// SZISZpong · Élő frissítés és indulás
import { localLogout } from './auth.js';
import { $app, $live, $nav, CFG, KIND_KEY, TOKEN_KEY, esc, namesOf, playerById, sb, setSb, state, store, toast } from './core.js';
import { loadAll } from './data.js';
import { openAch, openAward } from './honors-ui.js';
import { scoreHTML } from './matches.js';
import { rerenderIfLive, route } from './router.js';

/* ------------------------------------------------------------------
   4. Élő frissítés és indulás
   ------------------------------------------------------------------ */
export let reloadTimer = null;
export const incoming = new Set();

export function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await loadAll(); } catch { return; }
    for (const id of incoming) {
      state.fresh.add(id);
      const m = state.matches.find((x) => x.id === id);
      if (m && state.me && m.recordedBy !== state.me.id) {
        toast(`🏓 ${namesOf(m.winners)} nyert ${namesOf(m.losers)} ellen${m.scoreW != null ? ' (' + scoreHTML(m) + ')' : ''}`);
      }
    }
    incoming.clear();
    if (state.me) {
      const meNow = playerById(state.me.id);
      if (meNow && !meNow.active) { localLogout(); return; }
    }
    rerenderIfLive();
    setTimeout(() => state.fresh.clear(), 2500);
  }, 400);
}

export function subscribe() {
  sb.channel('sziszpong-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (p) => {
      if (p.eventType === 'INSERT' && p.new?.id) incoming.add(p.new.id);
      scheduleReload();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, scheduleReload)
    .subscribe((status) => $live.classList.toggle('on', status === 'SUBSCRIBED'));
}

export function showFatal(title, text, retry = true) {
  $nav.hidden = true;
  $app.innerHTML = `
    <div class="card empty">
      <span class="big">😵</span>
      <b style="display:block;font-size:18px;color:var(--text);margin-bottom:6px">${esc(title)}</b>
      ${esc(text)}
      ${retry ? '<div style="margin-top:16px"><button class="btn primary" onclick="location.reload()">Újrapróbálom</button></div>' : ''}
    </div>`;
}

export async function init() {
  if (!CFG.SUPABASE_URL || /IDE_JON/.test(CFG.SUPABASE_URL) || !window.supabase) {
    showFatal('Még nincs beállítva', 'A config.js fájlba be kell írni a Supabase adatait.', false);
    return;
  }
  setSb(window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
  if (window.Chart) { window.Chart.defaults.font.family = 'Outfit, system-ui, sans-serif'; }
  if (store.get(KIND_KEY) === 'doubles') state.matchesKind = 'doubles';

  try {
    await loadAll();
  } catch (e) {
    showFatal('Nem érem el az adatbázist', 'Ellenőrizd a netet, és próbáld újra. (' + (e.message || e) + ')');
    return;
  }

  state.token = store.get(TOKEN_KEY);
  if (state.token) {
    try {
      const { data } = await sb.rpc('me', { p_token: state.token });
      state.me = data || null;
    } catch { state.me = null; }
    if (!state.me) { state.token = null; store.del(TOKEN_KEY); }
  }

  // különdíj- és achievement-ikonok: koppintásra magyarázat (a sor linkje helyett)
  $app.addEventListener('click', (e) => {
    const aw = e.target.closest('[data-aw]');
    const ac = e.target.closest('[data-ach]');
    if (!aw && !ac) return;
    e.preventDefault(); e.stopPropagation();
    if (aw) openAward(aw.dataset.aw); else openAch(ac.dataset.ach, ac.dataset.pid);
  }, true);

  subscribe();
  window.addEventListener('hashchange', () => { state.profileKind = 'singles'; route(); window.scrollTo(0, 0); });
  // ha a telefon visszatér az apphoz, frissítünk (háttérben lemaradhatott valami)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
  route();
}

init();
