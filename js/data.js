// SZISZpong · Adatok betöltése és alap statisztikák
import { localISODate, nameOf, sb, state } from './core.js';
import { computeHonors } from './honors.js';

/* ------------------------------------------------------------------
   2. Adatok
   ------------------------------------------------------------------ */
export async function loadAll() {
  const [p, n] = await Promise.all([
    sb.from('players').select('id,name,elo,elo_doubles,is_admin,active,created_at'),
    sb.from('news').select('text,expires_on').eq('id', 1).maybeSingle(),
  ]);
  if (p.error) throw p.error;
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('matches')
      .select('id,played_at,kind,winner_side,score_1,score_2,note,recorded_by,match_players(player_id,side,elo_before,elo_after)')
      .order('played_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  state.players = p.data;
  state.news = n.data || null;
  state.matches = all.map(normalizeMatch).filter(Boolean);
  computeStats();
  computeHonors();
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
