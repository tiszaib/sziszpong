// SZISZpong · Bajnokság adatai (Lánchíd Kupa)
// Ez a kis modul mindig betöltődik (a meccsrögzítő kapcsolójához és a címvédőhöz kell);
// a Bajnokság fül nehéz része (arena-views.js) csak a fül megnyitásakor jön le.
import { sb, state, store } from './core.js';

const CACHE_KEY = 'sziszpong.tour.v1';
const SHOW_DONE = 3 * 86400000;   // a kész kupa bajnoka 3 napig látszik a Kupa fülön

state.tour = { cup: null, last: null, cups: 0, archive: [], archAt: null };
state.tourEnabled = true;          // false, ha a 004_bajnoksag.sql még nem futott le

const save = () => store.set(CACHE_KEY, JSON.stringify(state.tour));
export function readTourCache() {
  try {
    const c = JSON.parse(store.get(CACHE_KEY));
    if (c && Array.isArray(c.archive)) state.tour = { ...state.tour, ...c };
  } catch { /* nincs */ }
}

// Nyitott kupa (vagy a legutóbbi kész), és a legutóbbi bajnok. Egyszerre kb. 1–3 KB.
export async function loadTour() {
  if (!state.tourEnabled) return false;
  const { data, error } = await sb.rpc('tournament_state');
  if (error) {
    if (/tournament_state|function|schema cache/i.test(error.message || '')) state.tourEnabled = false;
    return false;
  }
  const before = JSON.stringify(state.tour.cup);
  state.tour.cup = data.cup || null;
  state.tour.last = data.last || null;
  state.tour.cups = data.cups || 0;
  save();
  return before !== JSON.stringify(state.tour.cup);
}

// Lezárt kupák (Hírlap, Csarnok): csak azokat kérjük le, amik a telefonon még nincsenek meg
export async function loadArchive() {
  if (!state.tourEnabled) return false;
  const t = state.tour;
  if (t.archive.length > t.cups) { t.archive = []; t.archAt = null; }   // törölt kupa: újra az egész
  if (t.archive.length === t.cups && t.archAt) return false;
  const { data, error } = await sb.rpc('tournament_archive', { p_after: t.archAt });
  if (error) return false;
  const byId = new Map(t.archive.map((c) => [c.id, c]));
  for (const c of data || []) byId.set(c.id, c);
  t.archive = [...byId.values()].sort((a, b) => Date.parse(a.finished) - Date.parse(b.finished));
  t.archAt = t.archive.length ? t.archive[t.archive.length - 1].finished : null;
  save();
  return (data || []).length > 0;
}

export const tourRounds = (size) => Math.log2(size);
export const isFinalGame = (cup, g) => g.r === tourRounds(cup.size) - 1;

// A Kupa fülön mutatott kupa: a nyitott, vagy 3 napig a frissen befejezett
export function shownCup() {
  const c = state.tour.cup;
  if (!c) return null;
  if (c.status === 'done' && Date.now() - Date.parse(c.finished) > SHOW_DONE) return null;
  return c;
}

// A két játékos most esedékes kupameccse (a meccsrögzítő kapcsolójához)
export function liveTourGame(a, b) {
  const c = state.tour.cup;
  if (!state.tourEnabled || !c || c.status !== 'running' || !a || !b) return null;
  const g = c.games.find((x) => !x.w && x.a && x.b && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  return g ? { cup: c, game: g, final: isFinalGame(c, g) } : null;
}

/* ---------- A kupa a többi fülön: címvédő babér, bajnoki krónika, kupameccsek ---------- */

// A címvédő: a legutóbbi lezárt kupa bajnoka (amíg a következő kupának nincs bajnoka)
export const defender = () => (state.tourEnabled ? state.tour.last?.champion || null : null);

// Arany babérkoszorú mini kupával (nem korona: a 👑 a ranglista elsőjéé)
const LEAVES = (() => {
  let s = '';
  for (const side of [-1, 1]) for (let k = 0; k < 5; k++) {
    const a = ((90 + side * (38 + k * 26)) * Math.PI) / 180;
    const x = 12 + 9.2 * Math.cos(a); const y = 12.6 + 9.2 * Math.sin(a);
    s += `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="2.3" ry="1" transform="rotate(${(90 + side * (38 + k * 26) + 90 + side * 30).toFixed(0)} ${x.toFixed(2)} ${y.toFixed(2)})"/>`;
  }
  return s;
})();
export const laurelHTML = (cls = '') => `<span class="laurel ${cls}" title="A Lánchíd Kupa címvédője" role="img" aria-label="A Lánchíd Kupa címvédője"><svg viewBox="0 0 24 24" aria-hidden="true"><g class="lv">${LEAVES}</g><path class="cup" d="M9.2 6.6h5.6v1.9a2.8 2.8 0 0 1-5.6 0zM12 11.3v2.1M10.2 14.2h3.6"/></svg></span>`;

// Minden kupa, amiről a telefon tud (lezártak + a mostani)
export function knownCups() {
  const all = [...state.tour.archive];
  const c = state.tour.cup;
  if (c && !all.some((x) => x.id === c.id)) all.push(c);
  return all;
}
const finalOf = (c) => c.games.find((g) => g.r === tourRounds(c.size) - 1);

// Ha ez a meccs egy lezárt kupa döntője volt: a kupa (a meccsek listájában arany sávot kap)
export function cupOfFinal(matchId) {
  return knownCups().find((c) => c.status === 'done' && finalOf(c)?.m === matchId) || null;
}
export const cupNo = (c) => state.tour.archive.findIndex((x) => x.id === c.id) + 1;

// Bajnoki krónika egy játékosról: kupák, győzelmek, döntők, kupameccs-mérleg, legjobb eredmény
const STAGES = ['Bajnok', 'Döntős', 'Elődöntő', 'Negyeddöntő', 'Nyolcaddöntő'];
export function chronicle(pid) {
  const cups = knownCups().filter((c) => ['running', 'done'].includes(c.status) && c.entries.some((e) => e.p === pid));
  if (!cups.length) return null;
  let titles = 0; let finals = 0; let best = 99;
  for (const c of cups.filter((x) => x.status === 'done')) {
    const f = finalOf(c);
    if (c.champion === pid) { titles++; finals++; best = 0; continue; }
    if (f && (f.a === pid || f.b === pid)) { finals++; best = Math.min(best, 1); continue; }
    const out = c.games.find((g) => g.r >= 0 && g.w && g.a && g.b && (g.a === pid || g.b === pid) && g.w !== pid);
    if (out) best = Math.min(best, tourRounds(c.size) - out.r);
  }
  const ms = state.matches.filter((m) => m.tourId && (m.winners.includes(pid) || m.losers.includes(pid)));
  const w = ms.filter((m) => m.winners.includes(pid)).length;
  return { cups: cups.length, titles, finals, w, l: ms.length - w, best: STAGES[best] || null };
}
