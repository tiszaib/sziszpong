// SZISZpong · Adatok betöltése és alap statisztikák
import { localISODate, nameOf, sb, state } from './core.js';
import { computeHonors } from './honors.js';

/* ------------------------------------------------------------------
   2. Adatok
   A meccseket a telefon eltárolja, és csak az újakat kéri le.
   Ha bármi nem stimmel (törölt/javított meccs), az egészet újratölti.
   ------------------------------------------------------------------ */
const CACHE_KEY = 'sziszpong.cache.v1';
const FULL_EVERY = 7 * 86400000;   // biztonsági teljes frissítés hetente
const OVERLAP = 5 * 60000;         // az utolsó tárolt meccs előtti 5 percet újra lekérjük
const MATCH_COLS = 'id,played_at,kind,winner_side,score_1,score_2,note,recorded_by,match_players(player_id,side,elo_before,elo_after)';
const PLAYER_COLS = 'id,name,elo,elo_doubles,is_admin,active,created_at';

let raw = [];        // nyers meccsek, legújabb elöl
let fullAt = 0;      // mikor volt utoljára teljes letöltés
let sig = '';        // a pontszám-ellenőrzés eredménye a legutóbbi teljes letöltéskor
let forceFull = false;
export const requestFull = () => { forceFull = true; };

const newestFirst = (a, b) => Date.parse(b.played_at) - Date.parse(a.played_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// Melyik játékosnál nem egyezik a tárolt meccsekből kijövő utolsó pontszám a játékos-táblával.
// Normál esetben üres; ha a teljes letöltés után sem az, azt alapállapotnak vesszük.
function mismatch(players, rows) {
  const last = { singles: new Map(), doubles: new Map() };
  for (const m of rows) for (const x of m.match_players || []) {
    const k = last[m.kind];
    if (k && !k.has(x.player_id)) k.set(x.player_id, x.elo_after);
  }
  return players
    .filter((p) => (last.singles.get(p.id) ?? 1000) !== p.elo || (last.doubles.get(p.id) ?? 1000) !== p.elo_doubles)
    .map((p) => `${p.id}:${p.elo}:${p.elo_doubles}`).sort().join(',');
}

async function fetchMatches(since) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('matches').select(MATCH_COLS);
    if (since) q = q.gte('played_at', since);
    const { data, error } = await q.order('played_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  return all;
}

export function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && c.v === 1 && Array.isArray(c.rows) && Array.isArray(c.players) ? c : null;
  } catch { return null; }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, fullAt, sig, players: state.players, news: state.news, rows: raw }));
  } catch {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* privát mód */ }
  }
}

// Azonnali indulás a tárolt adatokból (a frissítés utána jön a háttérben)
export function hydrate(c) {
  raw = c.rows; fullAt = c.fullAt || 0; sig = c.sig || '';
  state.players = c.players; state.news = c.news || null;
  build();
}

function build() {
  state.matches = raw.map(normalizeMatch).filter(Boolean);
  computeStats();
  computeHonors();
}

export async function loadAll({ full = false } = {}) {
  const [p, n, c] = await Promise.all([
    sb.from('players').select(PLAYER_COLS),
    sb.from('news').select('text,expires_on').eq('id', 1).maybeSingle(),
    sb.from('matches').select('id', { count: 'exact', head: true }),
  ]);
  if (p.error) throw p.error;
  let doFull = full || forceFull || !fullAt || Date.now() - fullAt > FULL_EVERY;
  if (!doFull) {
    const latest = raw.length ? Date.parse(raw[0].played_at) : 0;
    const fresh = await fetchMatches(new Date(Math.max(0, latest - OVERLAP)).toISOString());
    const byId = new Map(raw.map((m) => [m.id, m]));
    for (const m of fresh) byId.set(m.id, m);
    const merged = [...byId.values()].sort(newestFirst);
    const countOk = typeof c?.count !== 'number' || c.count === merged.length;
    if (countOk && mismatch(p.data, merged) === sig) raw = merged;
    else doFull = true;
  }
  if (doFull) {
    raw = (await fetchMatches()).sort(newestFirst);
    fullAt = Date.now();
    sig = mismatch(p.data, raw);
    forceFull = false;
  }
  state.players = p.data;
  state.news = n.data || null;
  build();
  writeCache();
}

// Egy meccs egységes alakra hozása: győztes és vesztes oldal (1 vagy 2 játékos)
export function normalizeMatch(m) {
  const mp = m.match_players || [];
  const win = mp.filter((x) => x.side === m.winner_side);
  const lose = mp.filter((x) => x.side !== m.winner_side);
  if (!win.length || !lose.length) return null;
  const byNameId = (a, b) => nameOf(a).localeCompare(nameOf(b), 'hu');
  return {
    id: m.id, at: m.played_at, kind: m.kind, note: m.note, recordedBy: m.recorded_by,
    winnerSide: m.winner_side,
    winners: win.map((x) => x.player_id).sort(byNameId),
    losers: lose.map((x) => x.player_id).sort(byNameId),
    side1: mp.filter((x) => x.side === 1).map((x) => x.player_id),
    side2: mp.filter((x) => x.side === 2).map((x) => x.player_id),
    after: Object.fromEntries(mp.map((x) => [x.player_id, x.elo_after])),
    before: Object.fromEntries(mp.map((x) => [x.player_id, x.elo_before])),
    delta: win[0].elo_after - win[0].elo_before,
    scoreW: m.winner_side === 1 ? m.score_1 : m.score_2,
    scoreL: m.winner_side === 1 ? m.score_2 : m.score_1,
    score1: m.score_1, score2: m.score_2,
  };
}

export const blankStats = () => ({ wins: 0, losses: 0, lastDelta: null, streak: 0, best: 1000, history: [], h2h: new Map(), partners: new Map() });

export function computeStats() {
  for (const kind of ['singles', 'doubles']) {
    const S = new Map();
    for (const p of state.players) S.set(p.id, blankStats());
    const bump = (map, key, field) => {
      if (!map.has(key)) map.set(key, { w: 0, l: 0 });
      map.get(key)[field]++;
    };
    for (const m of [...state.matches].reverse()) {          // időrendben
      if (m.kind !== kind) continue;
      for (const [ids, won] of [[m.winners, true], [m.losers, false]]) {
        for (const id of ids) {
          const s = S.get(id);
          if (!s) continue;
          if (won) { s.wins++; s.streak = s.streak > 0 ? s.streak + 1 : 1; }
          else { s.losses++; s.streak = s.streak < 0 ? s.streak - 1 : -1; }
          s.lastDelta = won ? m.delta : -m.delta;
          s.best = Math.max(s.best, m.after[id]);
          s.history.push({ at: m.at, elo: m.after[id] });
          for (const opp of (won ? m.losers : m.winners)) bump(s.h2h, opp, won ? 'w' : 'l');
          for (const mate of ids) if (mate !== id) bump(s.partners, mate, won ? 'w' : 'l');
        }
      }
    }
    state.stats[kind] = S;
  }
}

export const statsOf = (id, kind = 'singles') => state.stats[kind].get(id) || blankStats();
export const gamesOf = (id, kind) => { const s = statsOf(id, kind); return s.wins + s.losses; };

export function newsVisible() {
  const n = state.news;
  if (!n || !n.text) return false;
  return !n.expires_on || n.expires_on >= localISODate();
}
