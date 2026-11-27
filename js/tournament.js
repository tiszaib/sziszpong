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
