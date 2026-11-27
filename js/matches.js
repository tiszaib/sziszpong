// SZISZpong · Meccsek lista és meccs részletek
import { $app, $modal, KIND_KEY, clock, closeModal, dayLabel, esc, kindLabel, kindSwitch, modal, nameOf, namesOf, signed, state, store } from './core.js';
import { bandHTML } from './honors-ui.js';
import { startRematch } from './newmatch.js';
import { challengeBandHTML, challengeEvents } from './challenge.js';
import { cupNo, cupOfFinal, loadArchive } from './tournament.js';

// kupameccs jelölése: 🏆 Kupa, a döntő 2x
const tourTag = (m) => `<span class="x15 tour">🏆 Kupa${m.mult > 1 ? ' · 2x' : ''}</span>`;
const isCh = (m) => !!m.challengeId || (m.mult > 1 && !m.tourId);

/* ---------- Meccsek ---------- */
export const scoreHTML = (m) => (m.scoreW != null ? `${m.scoreW}:${m.scoreL}` : '');

export function matchCard(m) {
  const rec = m.recordedBy && !m.winners.includes(m.recordedBy) && !m.losers.includes(m.recordedBy)
    ? `<div class="rec">rögzítette: ${esc(nameOf(m.recordedBy))}</div>` : '';
  return `
    <button type="button" class="match ${m.kind === 'doubles' ? 'dbl' : ''} ${isCh(m) ? 'chm' : ''} ${m.tourId ? 'tgm' : ''} ${state.fresh.has(m.id) ? 'fresh' : ''}" data-match="${m.id}">
      <div class="side winner">
        <span class="pl">${m.winners.map((id) => esc(nameOf(id))).join('<br>')}</span>
        <span class="delta up">${signed(m.delta)}</span>
      </div>
      <div class="mid">
        ${m.scoreW != null ? `<div class="score">${scoreHTML(m)}</div>` : '<div class="vs">VS</div>'}
        <span class="when">${clock(m.at)}${m.note ? ' · 💬' : ''}</span>
        ${m.tourId ? tourTag(m) : isCh(m) ? '<span class="x15">⚔️ 1,5x</span>' : ''}
      </div>
      <div class="side right loser">
        <span class="pl">${m.losers.map((id) => esc(nameOf(id))).join('<br>')}</span>
        <span class="delta down">${signed(-m.delta)}</span>
      </div>
      ${rec}
    </button>`;
}

// events: kihívás-események (elfogadva, nem vállalta, lejárt), időrendben a meccsek közé keverve
export function matchListByDay(matches, bands = false, events = []) {
  let html = ''; let last = '';
  const day = (iso) => {
    const label = dayLabel(iso);
    if (label !== last) { html += `<div class="day-label">${esc(label)}</div>`; last = label; }
  };
  const evs = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let i = 0;
  const flush = (until) => {
    while (i < evs.length && (until == null || Date.parse(evs[i].at) > until)) { day(evs[i].at); html += challengeBandHTML(evs[i++]); }
  };
  for (const m of matches) {
    flush(Date.parse(m.at));
    day(m.at);
    if (bands) {
      for (const e of state.honors?.byMatch.get(m.id) || []) if (!e.kind || e.kind === m.kind) html += bandHTML(e);
      const cup = m.tourId ? cupOfFinal(m.id) : null;
      if (cup) html += `<div class="band tourb"><span class="band-ic">🏆</span><span class="band-tx"><b>Lánchíd Kupa${cupNo(cup) ? ` · ${cupNo(cup)}.` : ''}</b><span>A bajnok: <strong>${esc(nameOf(cup.champion))}</strong></span></span></div>`;
    }
    html += matchCard(m) + '<div style="height:8px"></div>';
  }
  flush(null);
  return html;
}

export function bindMatchCards(root = $app) {
  root.querySelectorAll('[data-match]').forEach((el) => { el.onclick = () => openMatch(el.dataset.match); });
}

export function renderMatches() {
  const kind = state.matchesKind;
  const all = state.matches.filter((m) => m.kind === kind);
  const list = all.slice(0, state.feedLimit);
  // kihívás-események csak az egyéni listában; ha van még korábbi meccs, csak a látható időszakéi
  const from = all.length > list.length && list.length ? Date.parse(list[list.length - 1].at) : -Infinity;
  const evs = kind === 'singles' ? challengeEvents().filter((e) => Date.parse(e.at) >= from) : [];
  $app.innerHTML = `
    <h1 class="page-title">Meccsek</h1>
    <p class="page-sub">Élőben frissül. Koppints egy meccsre a részletekért. A színes sávok a különdíjak gazdaváltásai és a kihívások.</p>
    ${kindSwitch(kind, 'mk')}
    ${list.length || evs.length ? matchListByDay(list, true, evs) : `<div class="card empty"><span class="big">📡</span>Még nincs ${kind === 'doubles' ? 'páros' : 'egyéni'} meccs.</div>`}
    ${all.length > list.length ? '<button class="btn block" id="more">Korábbi meccsek</button>' : ''}
  `;
  $app.querySelectorAll('#mk .tab').forEach((t) => {
    t.onclick = () => { state.matchesKind = t.dataset.kind; store.set(KIND_KEY, t.dataset.kind); state.feedLimit = 40; renderMatches(); };
  });
  bindMatchCards();
  // a kupadöntők arany sávjához a lezárt kupák kellenek (a telefon csak az újakat kéri le)
  loadArchive().then((ch) => { if (ch && state.view === 'matches' && $modal.hidden) { const y = window.scrollY; renderMatches(); window.scrollTo(0, y); } }).catch(() => {});
  const more = $app.querySelector('#more');
  if (more) more.onclick = () => { state.feedLimit += 40; renderMatches(); };
}

// Egymás elleni mérleg: ugyanaz a két játékos (egyéni) vagy ugyanaz a két pár (páros)
export function headToHead(m) {
  const key = (ids) => [...ids].sort().join('|');
  const a = key(m.winners); const b = key(m.losers);
  let aw = 0; let bw = 0;
  for (const x of state.matches) {
    if (x.kind !== m.kind) continue;
    const w = key(x.winners); const l = key(x.losers);
    if (w === a && l === b) aw++;
    else if (w === b && l === a) bw++;
  }
  return { aw, bw };
}

export function openMatch(id) {
  const m = state.matches.find((x) => x.id === id);
  if (!m) return;
  const h = headToHead(m);
  const people = (ids, cls) => ids.map((pid) => `
    <a class="md-player" href="#/profil/${pid}">
      <b>${esc(nameOf(pid))}</b>
      <span class="delta ${cls}">${signed(cls === 'up' ? m.delta : -m.delta)} → ${m.after[pid]}</span>
    </a>`).join('');
  modal({
    body: `
      <div class="md-head">${m.tourId ? `<span class="md-ch tour">🏆 Lánchíd Kupa${m.mult > 1 ? ' · döntő · 2x' : ''}</span>` : isCh(m) ? '<span class="md-ch">⚔️ Kihívás · 1,5x</span>' : `${kindLabel(m.kind)} meccs`} · ${esc(dayLabel(m.at))} ${clock(m.at)}</div>
      <div class="md-score">
        <div class="md-side win">${people(m.winners, 'up')}<span class="md-badge">🏆 nyert</span></div>
        <div class="md-mid">${m.scoreW != null ? `<span>${m.scoreW}</span><i>:</i><span>${m.scoreL}</span>` : '<i>VS</i>'}</div>
        <div class="md-side lose">${people(m.losers, 'down')}</div>
      </div>
      ${m.note ? `<div class="md-note">💬 ${esc(m.note)}</div>` : ''}
      <div class="section-title" style="margin-top:18px">Egymás ellen</div>
      <div class="md-h2h">
        <div><b>${h.aw}</b><span>${esc(namesOf(m.winners))}</span></div>
        <div class="md-h2h-bar"><i style="width:${h.aw + h.bw ? Math.round((h.aw / (h.aw + h.bw)) * 100) : 50}%"></i></div>
        <div><b>${h.bw}</b><span>${esc(namesOf(m.losers))}</span></div>
      </div>
      ${m.recordedBy && !m.winners.includes(m.recordedBy) && !m.losers.includes(m.recordedBy)
        ? `<p class="hint" style="text-align:center">rögzítette: ${esc(nameOf(m.recordedBy))}</p>` : ''}
      ${state.me ? '<button type="button" class="btn block rematch-btn" id="md-rm">🔁 Visszavágó</button>' : ''}`,
  });
  const b = document.getElementById('md-rm');
  if (b) b.onclick = () => { startRematch(m); closeModal(); location.hash = '#/uj'; };
}
