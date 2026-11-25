// SZISZpong · Különdíjak és achievementek kiszámolása (a meccsek visszajátszásából)
import { activePlayers, namesOf, state } from './core.js';

/* ------------------------------------------------------------------
   2b. Különdíjak és achievementek
   Minden a meccsekből számolódik: időrendben "lejátsszuk" a teljes
   történetet, így adatbázis-változás nélkül működik, és egy törölt
   meccs a hozzá tartozó achievementet is viszi.
   ------------------------------------------------------------------ */
export const DAY = 86400000;

// Achievementek. Mindegyiknek van egy vagy több szintje: [darabszám, a szint neve].
// unit = mit számolunk (a haladásnál ez látszik, pl. "27 / 40 éjszakai meccs").
const T = (...pairs) => pairs.map(([n, name]) => ({ n, name }));
export const ACH = [
  { id: 'first', group: 'Kezdő', icon: '🐣', desc: 'Játssz egy meccset.', unit: 'meccs', tiers: T([1, 'Első labda']) },
  { id: 'firstwin', group: 'Kezdő', icon: '🩸', desc: 'Nyerj meg egy meccset.', unit: 'győzelem', tiers: T([1, 'Első vér']) },
  { id: 'firstdbl', group: 'Kezdő', icon: '🤝', desc: 'Játssz egy páros meccset.', unit: 'páros meccs', tiers: T([1, 'Párban minden jobb']) },
  { id: 'games', group: 'Meccsszám', icon: '🏓', desc: 'Lejátszott meccsek, egyéni és páros együtt.', unit: 'meccs',
    tiers: T([10, 'KGY-termi újonc'], [20, 'Klubtag'], [50, 'Fanatikus'], [100, 'Kolis legenda'], [200, 'Örökös tag']) },
  { id: 'streak', group: 'Győzelmi sorozat', icon: '🔥', desc: 'Győzelmek zsinórban, egyéniben vagy párosban.', unit: 'győzelem zsinórban',
    tiers: T([3, 'Csusza'], [5, 'Megállíthatatlan'], [7, '67'], [10, 'Menace to society']) },
  { id: 'throne', group: 'Ranglista', icon: '👑', desc: 'Legyél 1. az egyéni ranglistán.', unit: '', tiers: T([1, 'VZS-trónfosztó']) },
  { id: 'throne_d', group: 'Ranglista', icon: '👯', desc: 'Legyél 1. a páros ranglistán.', unit: '', tiers: T([1, 'Couple goals']) },
  { id: 'king', group: 'Ranglista', icon: '🗡️', desc: 'Egyéniben győzd le az akkori 1. helyezettet.', unit: 'legyőzött első helyezett',
    tiers: T([1, 'Királygyilkos'], [3, 'Királygyilkos'], [10, 'Királygyilkos']) },
  { id: 'bagel', group: 'Különleges', icon: '🤠', desc: 'Nyerj egyéniben 11:0-ra.', unit: 'db 11:0',
    tiers: T([1, 'Berceli'], [3, 'Nusi néni kedvence'], [5, 'Bro...']) },
  { id: 'stonks', group: 'Különleges', icon: '📈', desc: 'Szerezz egy meccsen +25 pontot vagy többet.', unit: 'meccs +25 ponttal',
    tiers: T([1, 'STONKS'], [2, 'Hozamkedvelő']) },
  { id: 'night', group: 'Különleges', icon: '🦉', desc: 'Meccsek éjfél és hajnali 5 között.', unit: 'éjszakai meccs',
    tiers: T([10, 'DB-n emlegetett személy'], [20, 'Korán alvók kedvence'], [40, 'Csendháborító Champion']) },
  { id: 'early', group: 'Különleges', icon: '☀️', desc: 'Meccsek reggel 5 és 8 között.', unit: 'reggeli meccs',
    tiers: T([1, 'Early bird vagy turbina szökevény'], [5, 'Ki korán kel...'], [10, '...aranyat lel!'], [20, 'True early bird']) },
  { id: 'weekend', group: 'Különleges', icon: '🏠', desc: 'Meccsek szombaton és vasárnap.', unit: 'hétvégi meccs',
    tiers: T([10, 'Hétvégi bentlakó'], [20, 'Remete'], [40, 'Prime Robi']) },
  { id: 'lotyo', group: 'Különleges', icon: '💞', desc: 'Különböző páros társak.', unit: 'különböző társ',
    tiers: T([3, 'Páros lotyó'], [6, 'Poligám pongozó'], [10, 'Tinder Gold']) },
  { id: 'friend', group: 'Különleges', icon: '🌍', desc: 'Játssz minden aktív játékos ellen (aktív: volt meccse az elmúlt 2 hétben).', unit: '', tiers: T([1, 'Mindenki barátja']) },
  { id: 'nusi', group: 'Különleges', icon: '🫠', desc: 'Kapj ki egyéniben 11:0-ra.', unit: 'db 0:11', tiers: T([1, 'Nusi néni']) },
  { id: 'bagel_d', group: 'Különleges', icon: '🧑‍🔧', desc: 'Nyerjetek párosban 11:0-ra.', unit: '', tiers: T([1, 'Berceli & Kepler']) },
  { id: 'nusi_d', group: 'Különleges', icon: '👵', desc: 'Kapjatok ki párosban 11:0-ra.', unit: '', tiers: T([1, 'Nusi néni & Hugi néni']) },
];
// Mindenki barátja csak az ezutáni meccsekből jöhet (az első napokban még kevés aktív játékos volt, túl könnyű volt)
export const FRIEND_FROM = Date.parse('2026-11-21T15:15:00Z');
export const achDef = (id) => ACH.find((a) => a.id === id);
export const ACH_LEVELS = ACH.reduce((t, a) => t + a.tiers.length, 0);
// Szint-színek: bronz, ezüst, arany, gyémánt, legenda. Az egyszintesek aranyak.
export const TIER_COLORS = [['bronz', '#e39a5f'], ['ezüst', '#cfd6e6'], ['arany', '#ffd25a'], ['gyémánt', '#7fe3ff'], ['legenda', '#c58bff']];
export const tierColor = (a, level) => (a.tiers.length === 1 ? TIER_COLORS[2] : TIER_COLORS[level - 1]);

// Különdíjak. "both" = egy díj a két ranglistára együtt, különben egyéniben és párosban külön.
export const AWARDS = {
  magyar: { icon: '🇭🇺', name: 'A legnagyobb magyar', both: true, rule: 'Egyszerre vezeti az egyéni és a páros ranglistát. Ha nincs ilyen ember, senki nem kapja meg.' },
  verhetetlen: { icon: '🔥', name: 'Verhetetlen', rule: 'A leghosszabb jelenlegi győzelmi sorozat (legalább 3).' },
  feltorekvo: { icon: '🚀', name: 'Feltörekvő', rule: 'Aki 7 napja még 1000 pont alatt volt, és azóta a legtöbbet javított (legalább +30).' },
  unemployed: { icon: '🛋️', name: 'The unemployed friend', both: true, rule: 'A legtöbb meccs az elmúlt 7 napban (egyéni és páros együtt, legalább 3).' },
  feketelo: { icon: '🐎', name: 'Fekete ló', rule: 'Az elmúlt 7 nap legnagyobb meglepetés-győzelme: a legnagyobb pontkülönbséggel erősebb ellenfél legyőzése (legalább 50).' },
  nyugalom: { icon: '🧘', name: 'Nyugalom szigete', rule: 'A legjobb győzelmi arány a szoros meccseken, vagyis ahol 10:10 után tiebreak jött. Legalább 5 ilyen meccs kell hozzá.' },
  adomanyozo: { icon: '🎁', name: 'ELO adományozó', rule: 'A legtöbb elvesztett pont az elmúlt 7 napban.' },
};
export const awardKeys = (kind) => Object.keys(AWARDS).map((a) => (AWARDS[a].both ? a : `${a}:${kind}`));
export const awardOf = (key) => { const [a, kind] = key.split(':'); return { ...AWARDS[a], kind: kind || null }; };

export function computeHonors() {
  const chrono = [...state.matches].reverse();
  const active = new Set(activePlayers().map((p) => p.id));
  const KINDS = ['singles', 'doubles'];
  const mk = () => ({ singles: new Map(), doubles: new Map() });
  const rating = mk(); const played = mk(); const streak = mk(); const close = mk(); const throne = mk();
  const lead = { singles: { id: null, since: 0 }, doubles: { id: null, since: 0 } };
  const ach = new Map();
  const lastPlayed = new Map();   // aktív = volt meccse az elmúlt 14 napban
  const recent = (id, t) => active.has(id) && (lastPlayed.get(id) ?? -Infinity) > t - 14 * DAY;
  const per = new Map();
  const events = [];
  let holders = {};

  // Haladás rögzítése: value = az eddigi legjobb érték, dates = a megszerzett szintek időpontjai
  const give = (pid, aid, at, value = 1) => {
    if (!ach.has(pid)) ach.set(pid, new Map());
    const m = ach.get(pid);
    const r = m.get(aid) || { value: 0, dates: [] };
    r.value = Math.max(r.value, value);
    const tiers = achDef(aid).tiers;
    while (r.dates.length < tiers.length && tiers[r.dates.length].n <= r.value) r.dates.push(at);
    m.set(aid, r);
  };
  const P = (pid) => {
    if (!per.has(pid)) per.set(pid, { games: 0, wins: 0, dgames: 0, night: 0, early: 0, weekend: 0, bagel: 0, nusi: 0, stonks: 0, king: 0, beststreak: 0, partners: new Set(), opp: new Map(), best: { singles: 0, doubles: 0 } });
    return per.get(pid);
  };
  const leaderOf = (kind) => {
    let best = null; let top = -Infinity; let tie = false;
    for (const [id, n] of played[kind]) {
      if (!n || !active.has(id)) continue;
      const r = rating[kind].get(id);
      if (r > top) { top = r; best = id; tie = false; } else if (r === top) tie = true;
    }
    return tie ? null : best;
  };
  const avgBefore = (m, ids) => ids.reduce((t, id) => t + (m.before[id] ?? 1000), 0) / ids.length;

  // Ki viszi a díjat t időpontban? (i = az utolsó már lejátszott meccs indexe)
  function evalAwards(t, i, prev) {
    const res = {};
    const w7 = [];
    for (let j = i; j >= 0; j--) {
      const x = chrono[j]; const tx = Date.parse(x.at);
      if (tx <= t - 7 * DAY) break;
      w7.push(x);
    }
    // a legnagyobb értékű nyer; egyenlőségnél marad a régi gazda
    const pick = (key, scores, min, text) => {
      let best = -Infinity; let cands = [];
      for (const [id, v] of scores) {
        if (!recent(id, t) || v < min) continue;
        if (v > best) { best = v; cands = [id]; } else if (v === best) cands.push(id);
      }
      if (!cands.length) return;
      const inc = prev[key]?.ids[0];
      const id = cands.includes(inc) ? inc : cands[0];
      res[key] = { ids: [id], text: text(best, id) };
    };

    const ls = leaderOf('singles');
    if (ls && ls === leaderOf('doubles')) res.magyar = { ids: [ls], text: 'Egyéniben és párosban is ő az első.' };

    const cnt = new Map();
    for (const x of w7) for (const id of [...x.winners, ...x.losers]) cnt.set(id, (cnt.get(id) || 0) + 1);
    pick('unemployed', cnt, 3, (v) => `${v} meccs az elmúlt 7 napban`);

    for (const k of KINDS) {
      pick(`verhetetlen:${k}`, streak[k], 3, (v) => `${v} győzelem zsinórban`);

      const start = new Map();
      for (const x of w7) if (x.kind === k) for (const id of [...x.winners, ...x.losers]) start.set(id, x.before[id]);
      const gain = new Map();
      for (const [id, s] of start) if (s < 1000) gain.set(id, rating[k].get(id) - s);
      pick(`feltorekvo:${k}`, gain, 30, (v, id) => `+${v} pont 7 nap alatt (${start.get(id)} pontról indult)`);

      let up = null;
      for (const x of w7) {
        if (x.kind !== k || !x.winners.every((id) => recent(id, t))) continue;
        const gap = Math.round(avgBefore(x, x.losers) - avgBefore(x, x.winners));
        if (gap < 50) continue;
        const inc = prev[`feketelo:${k}`]?.matchId === x.id;
        if (!up || gap > up.gap || (gap === up.gap && inc)) up = { gap, x };
      }
      if (up) res[`feketelo:${k}`] = { ids: up.x.winners, matchId: up.x.id, text: `${up.gap} ponttal erősebb ellenfelet győzött le (${namesOf(up.x.losers)})` };

      const rate = new Map();
      for (const [id, c] of close[k]) if (c.n >= 5) rate.set(id, c.w / c.n);
      pick(`nyugalom:${k}`, rate, 0, (v, id) => `${Math.round(v * 100)}% a szoros meccseken (${close[k].get(id).w}/${close[k].get(id).n})`);

      const lost = new Map();
      for (const x of w7) if (x.kind === k) for (const id of x.losers) lost.set(id, (lost.get(id) || 0) + x.delta);
      pick(`adomanyozo:${k}`, lost, 1, (v) => `−${v} pont az elmúlt 7 napban`);
    }
    return res;
  }

  chrono.forEach((m, i) => {
    const k = m.kind; const t = Date.parse(m.at);
    const king = k === 'singles' ? leaderOf('singles') : null;
    const d = new Date(m.at); const h = d.getHours(); const wd = d.getDay();
    const closeGame = isTiebreak(m);
    for (const [ids, won] of [[m.winners, true], [m.losers, false]]) {
      for (const id of ids) {
        rating[k].set(id, m.after[id]);
        played[k].set(id, (played[k].get(id) || 0) + 1);
        const s = streak[k].get(id) || 0;
        const ns = won ? (s > 0 ? s + 1 : 1) : (s < 0 ? s - 1 : -1);
        streak[k].set(id, ns);
        const p = P(id);
        p.games++;
        if (ns > p.best[k]) p.best[k] = ns;
        if (won) p.wins++;
        if (k === 'doubles') p.dgames++;
        p.beststreak = Math.max(p.beststreak, ns);
        give(id, 'first', m.at, p.games);
        give(id, 'firstwin', m.at, p.wins);
        give(id, 'firstdbl', m.at, p.dgames);
        give(id, 'games', m.at, p.games);
        give(id, 'streak', m.at, p.beststreak);
        if (m.scoreW === 11 && m.scoreL === 0) {
          if (k === 'doubles') give(id, won ? 'bagel_d' : 'nusi_d', m.at);
          else if (won) give(id, 'bagel', m.at, ++p.bagel); else give(id, 'nusi', m.at, ++p.nusi);
        }
        if (won && m.delta >= 25) give(id, 'stonks', m.at, ++p.stonks);
        if (won && king && m.losers[0] === king) give(id, 'king', m.at, ++p.king);
        if (h < 5) give(id, 'night', m.at, ++p.night);
        if (h >= 5 && h < 8) give(id, 'early', m.at, ++p.early);
        if (wd === 0 || wd === 6) give(id, 'weekend', m.at, ++p.weekend);
        if (k === 'doubles') {
          for (const mate of ids) if (mate !== id) p.partners.add(mate);
          give(id, 'lotyo', m.at, p.partners.size);
        }
        for (const o of (won ? m.losers : m.winners)) if (!p.opp.has(o)) p.opp.set(o, m.at);
        if (closeGame) {
          const c = close[k].get(id) || { w: 0, n: 0 };
          c.n++; if (won) c.w++;
          close[k].set(id, c);
        }
      }
    }
    // Mindenki barátja: az akkor aktív (2 hétben játszó) összes játékos ellen játszott már
    for (const id of [...m.winners, ...m.losers]) lastPlayed.set(id, t);
    for (const id of [...m.winners, ...m.losers]) {
      const p = per.get(id);
      const others = [...lastPlayed.keys()].filter((o) => o !== id && recent(o, t));
      if (t >= FRIEND_FROM && others.length >= 3 && others.every((o) => p.opp.has(o))) give(id, 'friend', m.at);
    }

    // első hely változása (VZS-trónfosztó és trónon töltött idő)
    const L = lead[k]; const now = leaderOf(k);
    if (now !== L.id) {
      if (L.id) throne[k].set(L.id, (throne[k].get(L.id) || 0) + t - L.since);
      L.id = now; L.since = t;
    }
    if (now) give(now, k === 'singles' ? 'throne' : 'throne_d', m.at);

    // különdíjak gazdaváltása
    const next = evalAwards(t, i, holders);
    for (const key of Object.keys(next)) {
      const from = holders[key]?.ids || [];
      if (from.slice().sort().join() === next[key].ids.slice().sort().join()) continue;
      events.push({ at: m.at, matchId: m.id, key, kind: awardOf(key).kind, from, to: next[key].ids });
    }
    holders = next;
  });


  const nowT = Date.now();
  const throneNow = mk();
  for (const k of KINDS) {
    for (const [id, ms] of throne[k]) throneNow[k].set(id, ms);
    const L = lead[k];
    if (L.id) throneNow[k].set(L.id, (throneNow[k].get(L.id) || 0) + Math.max(0, nowT - L.since));
  }

  const byMatch = new Map();
  for (const e of events) {
    if (!byMatch.has(e.matchId)) byMatch.set(e.matchId, []);
    byMatch.get(e.matchId).push(e);
  }
  const current = evalAwards(nowT, chrono.length - 1, holders);
  const awardsOf = new Map();
  for (const [key, v] of Object.entries(current)) {
    for (const id of v.ids) {
      if (!awardsOf.has(id)) awardsOf.set(id, []);
      awardsOf.get(id).push(key);
    }
  }
  state.honors = { ach, events, byMatch, current, awardsOf, throne: throneNow, per, close, leader: { singles: lead.singles.id, doubles: lead.doubles.id } };
}

// Szoros meccs: 10:10 után tiebreak (a vesztes is legalább 10 pontot szerzett)
export function isTiebreak(m) { return m.scoreW != null && m.scoreL >= 10; }

export const achOf = (pid) => state.honors?.ach.get(pid) || new Map();
// Elért szint (0 = még nincs meg)
export const achLevel = (pid, aid) => achOf(pid).get(aid)?.dates.length || 0;
export const achLevels = (pid) => ACH.reduce((t, a) => t + achLevel(pid, a.id), 0);
