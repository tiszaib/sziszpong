// SZISZpong · Élő frissítés és indulás
import { localLogout } from './auth.js';
import { $app, $live, $nav, CFG, KIND_KEY, ME_KEY, TOKEN_KEY, esc, namesOf, playerById, sb, setSb, state, store, toast } from './core.js';
import { hydrate, loadAll, readCache, requestFull } from './data.js';
import { openAch, openAward } from './honors-ui.js';
import { scoreHTML } from './matches.js';
import { rerenderIfLive, route } from './router.js';
import { setChallengeRefresh, tickTimers } from './challenge.js';

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

let channel = null;
export function subscribe() {
  if (channel) return;
  channel = sb.channel('sziszpong-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (p) => {
      if (p.eventType === 'INSERT' && p.new?.id) incoming.add(p.new.id);
      else requestFull();          // javított vagy törölt meccs: mindent újratöltünk
      scheduleReload();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' }, scheduleReload)
    .subscribe((status) => $live.classList.toggle('on', status === 'SUBSCRIBED'));
}
function unsubscribe() {
  if (!channel) return;
  sb.removeChannel(channel);
  channel = null;
  $live.classList.remove('on');
}

// Ha az app egy percnél tovább a háttérben van, leállítjuk az élő kapcsolatot.
// Visszatéréskor újracsatlakozunk, és lekérjük, ami közben történt (csak az újakat).
let pauseTimer = null;
function onVisibility() {
  clearTimeout(pauseTimer);
  if (document.hidden) { pauseTimer = setTimeout(unsubscribe, 60000); return; }
  subscribe();
  scheduleReload();
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

  state.token = store.get(TOKEN_KEY);
  const cached = readCache();
  let cachedMe = null;
  try { cachedMe = state.token ? JSON.parse(store.get(ME_KEY)) : null; } catch { /* nincs */ }
  let sync;
  if (cached && (!state.token || cachedMe)) {
    // azonnal rajzolunk a telefonon tárolt adatokból, a friss adat a háttérben jön
    hydrate(cached);
    state.me = cachedMe;
    sync = Promise.all([loadAll(), checkMe()]);
  } else {
    try {
      await loadAll();
    } catch (e) {
      showFatal('Nem érem el az adatbázist', 'Ellenőrizd a netet, és próbáld újra. (' + (e.message || e) + ')');
      return;
    }
    try { await checkMe(); } catch { state.me = null; }
  }

  // különdíj- és achievement-ikonok: koppintásra magyarázat (a sor linkje helyett)
  $app.addEventListener('click', (e) => {
    const aw = e.target.closest('[data-aw]');
    const ac = e.target.closest('[data-ach]');
    if (!aw && !ac) return;
    e.preventDefault(); e.stopPropagation();
    if (aw) openAward(aw.dataset.aw); else openAch(ac.dataset.ach, ac.dataset.pid);
  }, true);

  setChallengeRefresh(() => rerenderIfLive());
  // kihívás-visszaszámlálók percenként; ha valami lejárt, újrarajzolunk
  setInterval(() => { if (!document.hidden && tickTimers()) rerenderIfLive(); }, 60000);

  subscribe();
  window.addEventListener('hashchange', () => { state.profileKind = 'singles'; route(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', onVisibility);
  route();
  if (sync) {
    const wasMe = state.me?.id;
    sync.then(() => { if (state.me?.id !== wasMe) route(); else rerenderIfLive(); })
      .catch(() => toast('Nincs net, a legutóbb betöltött adatokat látod.'));
  }
}

// A tárolt belépés még érvényes-e. Net nélkül (hiba esetén) nem léptetünk ki senkit.
async function checkMe() {
  if (!state.token) { state.me = null; return; }
  const { data, error } = await sb.rpc('me', { p_token: state.token });
  if (error) { if (!state.me) throw error; return; }
  state.me = data || null;
  if (state.me) store.set(ME_KEY, JSON.stringify(state.me));
  else { state.token = null; store.del(TOKEN_KEY); store.del(ME_KEY); }
}

init();
