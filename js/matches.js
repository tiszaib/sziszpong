// SZISZpong · Meccsek lista és meccs részletek
import { $app, KIND_KEY, clock, closeModal, dayLabel, esc, kindLabel, kindSwitch, modal, nameOf, namesOf, signed, state, store } from './core.js';
import { bandHTML } from './honors-ui.js';
import { startRematch } from './newmatch.js';

/* ---------- Meccsek ---------- */
export const scoreHTML = (m) => (m.scoreW != null ? `${m.scoreW}:${m.scoreL}` : '');

export function matchCard(m) {
  const rec = m.recordedBy && !m.winners.includes(m.recordedBy) && !m.losers.includes(m.recordedBy)
    ? `<div class="rec">rögzítette: ${esc(nameOf(m.recordedBy))}</div>` : '';
  return `
    <button type="button" class="match ${m.kind === 'doubles' ? 'dbl' : ''} ${state.fresh.has(m.id) ? 'fresh' : ''}" data-match="${m.id}">
      <div class="side winner">
        <span class="pl">${m.winners.map((id) => esc(nameOf(id))).join('<br>')}</span>
        <span class="delta up">${signed(m.delta)}</span>
      </div>
      <div class="mid">
        ${m.scoreW != null ? `<div class="score">${scoreHTML(m)}</div>` : '<div class="vs">VS</div>'}
        <span class="when">${clock(m.at)}${m.note ? ' · 💬' : ''}</span>
      </div>
      <div class="side right loser">
        <span class="pl">${m.losers.map((id) => esc(nameOf(id))).join('<br>')}</span>
        <span class="delta down">${signed(-m.delta)}</span>
      </div>
      ${rec}
    </button>`;
}

export function matchListByDay(matches, bands = false) {
  let html = ''; let last = '';
  for (const m of matches) {
    const label = dayLabel(m.at);
    if (label !== last) { html += `<div class="day-label">${esc(label)}</div>`; last = label; }
    if (bands) {
      for (const e of state.honors?.byMatch.get(m.id) || []) if (!e.kind || e.kind === m.kind) html += bandHTML(e);
    }
    html += matchCard(m) + '<div style="height:8px"></div>';
  }
  return html;
}

export function bindMatchCards(root = $app) {
  root.querySelectorAll('[data-match]').forEach((el) => { el.onclick = () => openMatch(el.dataset.match); });
}

export function renderMatches() {
  const kind = state.matchesKind;
  const all = state.matches.filter((m) => m.kind === kind);
  const list = all.slice(0, state.feedLimit);
  $app.innerHTML = `
    <h1 class="page-title">Meccsek</h1>
    <p class="page-sub">Élőben frissül. Koppints egy meccsre a részletekért. A színes sávok a különdíjak gazdaváltásai.</p>
    ${kindSwitch(kind, 'mk')}
    ${list.length ? matchListByDay(list, true) : `<div class="card empty"><span class="big">📡</span>Még nincs ${kind === 'doubles' ? 'páros' : 'egyéni'} meccs.</div>`}
    ${all.length > list.length ? '<button class="btn block" id="more">Korábbi meccsek</button>' : ''}
  `;
  $app.querySelectorAll('#mk .tab').forEach((t) => {
    t.onclick = () => { state.matchesKind = t.dataset.kind; store.set(KIND_KEY, t.dataset.kind); state.feedLimit = 40; renderMatches(); };
  });
  bindMatchCards();
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
      <div class="md-head">${kindLabel(m.kind)} meccs · ${esc(dayLabel(m.at))} ${clock(m.at)}</div>
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
