// SZISZpong · Statisztikáim oldal
import { $app, K, dateTime, eloDelta, esc, kindLabel, localISODate, nameOf, namesOf, ranked, ratingOf, signed, state } from './core.js';
import { gamesOf, statsOf } from './data.js';
import { DAY, isTiebreak } from './honors.js';
import { bindMatchCards, scoreHTML } from './matches.js';

/* ---------- Statisztikáim (csak a saját profilon) ---------- */
export const WEEKDAYS = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
export const WD_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
export const DAYPARTS = [['éjjel', 0, 5], ['reggel', 5, 10], ['napközben', 10, 17], ['este', 17, 24]];
export const partOf = (h) => DAYPARTS.find(([, a, b]) => h >= a && h < b)[0];

export function duration(ms) {
  const days = Math.floor(ms / DAY); const hours = Math.floor((ms % DAY) / 3600000);
  if (days) return `${days} nap${hours ? ` ${hours} óra` : ''}`;
  if (hours) return `${hours} óra`;
  return `${Math.max(1, Math.round(ms / 60000))} perc`;
}

export function renderMyStats() {
  const me = state.me.id;
  const mine = [...state.matches].reverse().filter((m) => m.winners.includes(me) || m.losers.includes(me))
    .map((m) => {
      const won = m.winners.includes(me);
      return { m, won, d: new Date(m.at), opps: won ? m.losers : m.winners, mates: (won ? m.winners : m.losers).filter((x) => x !== me) };
    });
  const card = (icon, title, inner) => `<div class="card scard"><div class="scard-h"><span>${icon}</span>${title}</div>${inner}</div>`;
  const pct = (w, n) => (n ? Math.round((w / n) * 100) + '%' : '–');

  if (!mine.length) {
    $app.innerHTML = `<h1 class="page-title">📊 Statisztikáim</h1>
      <div class="card empty"><span class="big">🏓</span>Még nincs meccsed. Játssz egyet, és itt megjelennek a statjaid!</div>`;
    return;
  }

  // 1. Mikor vagy a csúcson
  const wd = Array.from({ length: 7 }, () => ({ w: 0, n: 0 }));
  const dp = Object.fromEntries(DAYPARTS.map(([n]) => [n, { w: 0, n: 0 }]));
  for (const r of mine) {
    const a = wd[r.d.getDay()]; a.n++; if (r.won) a.w++;
    const b = dp[partOf(r.d.getHours())]; b.n++; if (r.won) b.w++;
  }
  const maxN = Math.max(...wd.map((x) => x.n));
  const favDay = wd.indexOf(wd.reduce((a, b) => (b.n > a.n ? b : a)));
  const bestOf = (entries) => entries.filter(([, x]) => x.n >= 3).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n || b[1].n - a[1].n)[0];
  const bestDay = bestOf(wd.map((x, i) => [i, x]));
  const bestPart = bestOf(Object.entries(dp));
  const favPart = Object.entries(dp).sort((a, b) => b[1].n - a[1].n)[0][0];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const peak = card('⏰', 'Mikor vagy a csúcson', `
    <div class="weekbars">${order.map((i) => `
      <div class="wb ${bestDay && +bestDay[0] === i ? 'best' : ''}"><i style="height:${maxN ? Math.max(6, Math.round((wd[i].n / maxN) * 100)) : 6}%"></i><span>${WD_SHORT[i]}</span></div>`).join('')}</div>
    <div class="sline">Legtöbbet <b>${WEEKDAYS[favDay].toLowerCase()}</b> és <b>${favPart}</b> játszol.</div>
    ${bestDay ? `<div class="sline">Legjobb napod (zöld oszlop): <b>${WEEKDAYS[bestDay[0]]}</b>, ${pct(bestDay[1].w, bestDay[1].n)} győzelem</div>` : ''}
    ${bestPart ? `<div class="sline">Legjobb napszakod: <b>${bestPart[0]}</b>, ${pct(bestPart[1].w, bestPart[1].n)} győzelem</div>` : ''}
    ${!bestDay ? '<div class="hint">A legjobb napodhoz legalább 3 meccs kell ugyanazon a napon.</div>' : ''}`);

  // 2. Nemesis és kedvenc áldozat (egyéni, legalább 3 meccs)
  const h2h = [...statsOf(me, 'singles').h2h.entries()].map(([id, r]) => ({ id, ...r, n: r.w + r.l })).filter((r) => r.n >= 3);
  const nemesis = h2h.filter((r) => r.l > 0).sort((a, b) => a.w / a.n - b.w / b.n || b.l - a.l)[0];
  const victim = h2h.filter((r) => r.w > 0 && r.id !== nemesis?.id).sort((a, b) => b.w / b.n - a.w / a.n || b.w - a.w)[0];
  const person = (r, label, cls) => (r ? `
    <a class="duo ${cls}" href="#/profil/${r.id}"><small>${label}</small><b>${esc(nameOf(r.id))}</b><span>${r.w} – ${r.l}</span></a>`
    : `<div class="duo off"><small>${label}</small><b>–</b><span>még nincs</span></div>`);
  const rivals = card('😈', 'Nemesis és kedvenc áldozat', `
    <div class="duos">${person(nemesis, 'Nemesis', 'bad')}${person(victim, 'Kedvenc áldozat', 'good')}</div>
    <div class="hint">Egyéni meccsek alapján, legalább 3 meccs kell ugyanazzal az ellenféllel.</div>`);

  // 3. Legnagyobb győzelem és legfájóbb vereség
  const wins = mine.filter((r) => r.won).sort((a, b) => b.m.delta - a.m.delta);
  const losses = mine.filter((r) => !r.won).sort((a, b) => b.m.delta - a.m.delta);
  const mrow = (r, label, cls) => (r ? `
    <button type="button" class="mrow ${cls}" data-match="${r.m.id}">
      <small>${label}</small>
      <b>${signed(r.won ? r.m.delta : -r.m.delta)}</b>
      <span>${r.won ? 'vs' : 'tőle:'} ${esc(namesOf(r.opps))}${r.m.scoreW != null ? ` · ${scoreHTML(r.m)}` : ''} · ${dateTime(r.m.at)}</span>
    </button>` : '');
  const biggest = card('💥', 'Legnagyobb győzelem és legfájóbb vereség',
    (mrow(wins[0], 'Legnagyobb győzelem', 'good') + mrow(losses[0], 'Legfájóbb vereség', 'bad')) || '<div class="hint">Még nincs ilyen.</div>');

  // 4. Rekordsorozat
  const per = state.honors.per.get(me);
  const cur = (k) => statsOf(me, k).streak;
  const recRow = (k) => (gamesOf(me, k) ? `<div class="sline">${kindLabel(k)}: <b>${per.best[k]}</b> győzelem zsinórban${cur(k) > 0 ? ` <span class="muted">(most ${cur(k)})</span>` : ''}</div>` : '');
  const record = card('🔥', 'Rekordsorozat', recRow('singles') + recRow('doubles'));

  // 5. Az idegeid
  const scored = mine.filter((r) => r.m.scoreW != null);
  const tight = scored.filter((r) => isTiebreak(r.m));
  const tw = tight.filter((r) => r.won).length;
  const avg = (rs) => (rs.length ? (rs.reduce((t, r) => t + r.m.scoreW - r.m.scoreL, 0) / rs.length).toFixed(1).replace('.', ',') : null);
  const aw = avg(scored.filter((r) => r.won)); const al = avg(scored.filter((r) => !r.won));
  const nerves = card('🧠', 'Az idegeid', scored.length ? `
    <div class="big-num">${pct(tw, tight.length)}<small>${tight.length ? `győzelem a szoros meccseken (${tw}/${tight.length})` : 'még nem volt tiebreakes meccsed'}</small></div>
    ${aw ? `<div class="sline">Ha nyersz, átlagosan <b>${aw}</b> ponttal nyersz.</div>` : ''}
    ${al ? `<div class="sline">Ha kikapsz, átlagosan <b>${al}</b> ponttal kapsz ki.</div>` : ''}
    <div class="hint">Szoros meccs: 10:10 után tiebreak. Csak a beírt eredményű meccsek számítanak.</div>`
    : '<div class="hint">Ehhez beírt eredményű meccsek kellenek.</div>');

  // 6. Célpont
  const target = (k) => {
    if (!gamesOf(me, k)) return '';
    const list = ranked(k); const pos = list.findIndex((p) => p.id === me);
    if (pos < 0) return '';
    const mineR = ratingOf(list[pos], k);
    if (pos === 0) {
      const second = list[1];
      return `<div class="sline">${kindLabel(k)}: <b>Te vagy az első! 👑</b>${second ? ` Mögötted ${esc(second.name)}, ${mineR - ratingOf(second, k)} ponttal.` : ''}</div>`;
    }
    const above = list[pos - 1]; const gap = ratingOf(above, k) - mineR;
    let a = mineR; let b = ratingOf(above, k); let n = 0;
    while (a <= b && n < 30) { const dd = eloDelta(a, b); a += dd; b -= dd; n++; }
    return `<div class="sline">${kindLabel(k)}: előtted <b>${esc(above.name)}</b>, <b>${gap || 'ugyanannyi'}</b>${gap ? ' ponttal' : ' pont'}.${k === 'singles' ? ` Kb. <b>${n}</b> győzelem ellene, és megelőzöd.` : ''}</div>`;
  };
  const goal = card('🎯', 'Célpont', target('singles') + target('doubles'));

  // 7. Hűség
  const withCount = new Map();
  for (const r of mine) for (const id of [...r.opps, ...r.mates]) withCount.set(id, (withCount.get(id) || 0) + 1);
  const loyal = [...withCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const loyalty = card('💍', 'Hűség', loyal.map(([id, n], i) => `
    <div class="sline">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} <a href="#/profil/${id}"><b>${esc(nameOf(id))}</b></a>: a meccseid ${Math.round((n / mine.length) * 100)}%-a (${n})</div>`).join(''));

  // 8. Aktivitás
  const days = new Map();
  for (const r of mine) { const key = localISODate(r.d); days.set(key, (days.get(key) || 0) + 1); }
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const weeks = Math.max(1, (Date.now() - mine[0].d.getTime()) / (7 * DAY));
  const activity = card('📅', 'Aktivitás', `
    <div class="mini-stats">
      <div><b>${days.size}</b><span>játéknap</span></div>
      <div><b>${(mine.length / weeks).toFixed(1).replace('.', ',')}</b><span>meccs / hét</span></div>
      <div><b>${busiest[1]}</b><span>meccs egy nap alatt</span></div>
    </div>
    <div class="sline">Legaktívabb napod: <b>${new Date(busiest[0] + 'T12:00').toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })}</b></div>
    <div class="sline">Első meccsed: <b>${dateTime(mine[0].m.at)}</b></div>`);

  // 9. Trónon töltött idő
  const th = (k) => state.honors.throne[k].get(me) || 0;
  const throneCard = card('👑', 'Trónon töltött idő', (th('singles') || th('doubles')) ? `
    ${th('singles') ? `<div class="sline">Egyéniben: <b>${duration(th('singles'))}</b>${state.honors.leader.singles === me ? ' <span class="muted">(és most is te vagy az első)</span>' : ''}</div>` : ''}
    ${th('doubles') ? `<div class="sline">Párosban: <b>${duration(th('doubles'))}</b>${state.honors.leader.doubles === me ? ' <span class="muted">(és most is te vagy az első)</span>' : ''}</div>` : ''}`
    : '<div class="sline">Még nem voltál első. A trón vár! 👀</div>');

  $app.innerHTML = `
    <a class="back" href="#/profil">‹ Profil</a>
    <h1 class="page-title">📊 Statisztikáim</h1>
    <p class="page-sub">Ezt csak te látod. ${mine.length} meccs alapján.</p>
    ${peak}${rivals}${biggest}${record}${nerves}${goal}${loyalty}${activity}${throneCard}`;
  bindMatchCards();
}
