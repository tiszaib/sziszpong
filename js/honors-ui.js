// SZISZpong · Különdíjak és achievementek a felületen, gratuláció
import { $modal, dateTime, esc, kindLabel, modal, namesOf, state, store } from './core.js';
import { ACH, achOf, awardOf } from './honors.js';

/* ---------- Különdíjak és achievementek a felületen ---------- */
export const awardIcons = (pid, kind) => (state.honors?.awardsOf.get(pid) || [])
  .filter((key) => { const a = awardOf(key); return !kind || !a.kind || a.kind === kind; })
  .map((key) => `<span class="aw" data-aw="${key}" role="button" title="${esc(awardOf(key).name)}">${awardOf(key).icon}</span>`).join('');

export function openAward(key) {
  const a = awardOf(key);
  const cur = state.honors?.current[key];
  modal({
    title: `${a.icon} ${a.name}`,
    body: `
      ${a.kind ? `<div class="aw-kind">${kindLabel(a.kind)} különdíj</div>` : ''}
      <p class="aw-rule">${esc(a.rule)}</p>
      ${cur ? `<div class="aw-holder"><b>${esc(namesOf(cur.ids))}</b><span>${esc(cur.text)}</span></div>`
        : '<p class="aw-rule">Most senkinél sincs.</p>'}`,
  });
}

export function openAch(id, pid) {
  const a = ACH.find((x) => x.id === id);
  const at = achOf(pid).get(id);
  modal({
    body: `
      <div class="ach-big ${at ? '' : 'off'}">${a.icon}</div>
      <h3 style="text-align:center;margin-bottom:6px">${esc(a.name)}</h3>
      <p style="text-align:center">${esc(a.desc)}</p>
      <p class="hint" style="text-align:center">${at ? `Megszerezve: ${dateTime(at)}` : 'Még nincs meg.'}</p>`,
  });
}

// Lenyitható blokk (az egész sorra koppintva nyílik)
export const fold = (title, count, inner, open = false) => `
  <details class="fold" ${open ? 'open' : ''}>
    <summary><span class="fold-arrow">▸</span><span class="fold-title">${title}</span>${count != null ? `<span class="fold-count">${count}</span>` : ''}</summary>
    <div class="fold-body">${inner}</div>
  </details>`;

export function achGrid(pid) {
  const mine = achOf(pid);
  return `<div class="ach-grid">${ACH.map((a) => `
    <button type="button" class="ach ${mine.has(a.id) ? '' : 'off'}" data-ach="${a.id}" data-pid="${pid}">
      <span class="ach-ic">${a.icon}</span><span class="ach-nm">${esc(a.name)}</span>
    </button>`).join('')}</div>`;
}

// Különdíj-váltás sáv a meccslistában
export function bandHTML(e) {
  const a = awardOf(e.key);
  return `
    <div class="band">
      <span class="band-ic">${a.icon}</span>
      <span class="band-tx"><b>${esc(a.name)}</b><span>${e.from.length ? `${esc(namesOf(e.from))} → ` : 'új gazda: '}<strong>${esc(namesOf(e.to))}</strong></span></span>
    </div>`;
}

// Gratuláció az új achievementekért (a telefon megjegyzi, miket látott már)
export function checkNewAchievements() {
  if (!state.me || !state.honors || !$modal.hidden) return;
  const key = 'sziszpong.seenAch.' + state.me.id;
  const earned = [...achOf(state.me.id).keys()];
  let seen = [];
  try { seen = JSON.parse(store.get(key) || '[]'); } catch { seen = []; }
  const fresh = earned.filter((id) => !seen.includes(id));
  store.set(key, JSON.stringify(earned));
  if (!fresh.length) return;
  const list = fresh.map((id) => ACH.find((a) => a.id === id));
  modal({
    body: `
      <div class="congrats">
        <div class="congrats-ic">${list.length === 1 ? list[0].icon : '🏆'}</div>
        <h3>${list.length === 1 ? 'Új achievement!' : `${list.length} új achievement!`}</h3>
        ${list.length <= 3
          ? list.map((a) => `<div class="congrats-item"><span>${a.icon}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')
          : `<div class="ach-grid">${list.map((a) => `<div class="ach"><span class="ach-ic">${a.icon}</span><span class="ach-nm">${esc(a.name)}</span></div>`).join('')}</div>
             <p class="hint" style="margin-top:12px">A profilodon megnézheted, melyik mit jelent.</p>`}
      </div>`,
  });
  confetti();
}

export function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#c6ff3d', '#ff7a1a', '#ffd25a', '#3ee08f', '#ff5a7a', '#8fd3ff'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.6 + 's';
    s.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3800);
}
