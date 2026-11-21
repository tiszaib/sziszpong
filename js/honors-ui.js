// SZISZpong · Különdíjak és achievementek a felületen, gratuláció
import { $modal, dateTime, esc, kindLabel, modal, namesOf, state, store } from './core.js';
import { ACH, achDef, achLevel, achOf, awardOf, tierColor } from './honors.js';

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

// Egy achievement állása egy játékosnál
export function achInfo(pid, a) {
  const r = achOf(pid).get(a.id) || { value: 0, dates: [] };
  const level = r.dates.length;
  const max = a.tiers.length;
  const next = a.tiers[level] || null;
  const name = a.tiers[Math.max(0, level - 1)].name;
  const color = level ? tierColor(a, level) : null;
  return { value: r.value, dates: r.dates, level, max, next, name, color, done: level === max };
}

// Hány %-ának van meg legalább az adott szinten (aktív, már játszott játékosok között)
export function rarity(a, lvl = 1) {
  const pool = state.players.filter((p) => p.active && (state.honors?.per.get(p.id)?.games || 0) > 0);
  if (!pool.length) return 0;
  return Math.round((pool.filter((p) => achLevel(p.id, a.id) >= lvl).length / pool.length) * 100);
}

const tierDot = (c) => `<i class="tdot" style="--tc:${c[1]}"></i>`;

export function openAch(id, pid) {
  const a = achDef(id);
  const x = achInfo(pid, a);
  const multi = x.max > 1;
  const rare = rarity(a);
  // kinek van meg a legmagasabb elért szinten
  const pool = state.players.filter((p) => p.active);
  const topLvl = Math.max(0, ...pool.map((p) => achLevel(p.id, a.id)));
  const tops = topLvl ? pool.filter((p) => achLevel(p.id, a.id) === topLvl).map((p) => p.name) : [];
  modal({
    body: `
      <div class="achd-head">
        <div class="achd-ic ${x.level ? '' : 'off'}" style="--tc:${x.color ? x.color[1] : 'var(--border)'}">${a.icon}</div>
        <h3>${esc(x.name)}</h3>
        ${multi && x.level ? `<div class="achd-lvl" style="color:${x.color[1]}">${x.level}. szint · ${x.color[0]}</div>` : ''}
        <p>${esc(a.desc)}</p>
      </div>
      ${multi ? `<div class="ladder">${a.tiers.map((t, i) => {
        const got = i < x.level; const isNext = i === x.level;
        const c = tierColor(a, i + 1);
        return `<div class="rung ${got ? 'got' : isNext ? 'next' : 'lock'}" style="--tc:${c[1]}">
          <span class="rung-st">${got ? '✓' : isNext ? '▸' : '🔒'}</span>
          <span class="rung-nm"><b>${esc(t.name)}</b><small>${t.n} ${esc(a.unit)}</small></span>
          <span class="rung-r">${got ? dateTime(x.dates[i]) : isNext ? `${x.value} / ${t.n}` : ''}</span>
        </div>`;
      }).join('')}</div>`
        : `<p class="hint" style="text-align:center">${x.level ? `Megszerezve: ${dateTime(x.dates[0])}` : 'Még nincs meg.'}</p>`}
      <div class="achd-foot">
        <span>${rare <= 15 ? '💎 ' : ''}A játékosok ${rare}%-ának van meg.</span>
        ${tops.length ? `<span>${multi ? `Legmagasabb szinten (${topLvl}.)` : 'Megvan'}: <b>${esc(tops.slice(0, 4).join(', '))}${tops.length > 4 ? ` +${tops.length - 4}` : ''}</b></span>` : ''}
      </div>`,
  });
}

// Lenyitható blokk (az egész sorra koppintva nyílik)
export const fold = (title, count, inner, open = false) => `
  <details class="fold" ${open ? 'open' : ''}>
    <summary><span class="fold-arrow">▸</span><span class="fold-title">${title}</span>${count != null ? `<span class="fold-count">${count}</span>` : ''}</summary>
    <div class="fold-body">${inner}</div>
  </details>`;

// Különdíj-váltás sáv a meccslistában
export function bandHTML(e) {
  const a = awardOf(e.key);
  return `
    <div class="band">
      <span class="band-ic">${a.icon}</span>
      <span class="band-tx"><b>${esc(a.name)}</b><span>${e.from.length ? `${esc(namesOf(e.from))} → ` : 'új gazda: '}<strong>${esc(namesOf(e.to))}</strong></span></span>
    </div>`;
}

// Gratuláció az új achievementekért és szintekért (a telefon megjegyzi, miket látott már)
export function checkNewAchievements() {
  if (!state.me || !state.honors || !$modal.hidden) return;
  const key = 'sziszpong.seenAch.' + state.me.id;
  const earned = [];
  for (const a of ACH) for (let l = 1; l <= achLevel(state.me.id, a.id); l++) earned.push(`${a.id}:${l}`);
  let seen = null;
  try { seen = JSON.parse(store.get(key) || 'null'); } catch { seen = null; }
  store.set(key, JSON.stringify(earned));
  // régi (szintek előtti) formátum: amit eddig láttál, azt nem mutatjuk újra
  if (Array.isArray(seen) && seen.length && !seen.some((x) => String(x).includes(':'))) return;
  const fresh = earned.filter((x) => !(seen || []).includes(x));
  if (!fresh.length) return;
  // egy achievementből csak a legmagasabb új szintet mutatjuk
  const top = new Map();
  for (const x of fresh) { const [id, l] = x.split(':'); if (!top.has(id) || +l > top.get(id)) top.set(id, +l); }
  const list = [...top].map(([id, l]) => `${id}:${l}`).map((x) => {
    const [id, l] = x.split(':'); const a = achDef(id);
    return { a, name: a.tiers[l - 1].name, color: tierColor(a, +l), lvl: +l };
  });
  const item = (x) => `<div class="congrats-item" style="--tc:${x.color[1]}"><span class="ci-ic">${x.a.icon}</span><div><b>${esc(x.name)}</b><small>${x.a.tiers.length > 1 ? `${x.lvl}. szint (${x.color[0]}) · ` : ''}${x.a.tiers.length > 1 ? `${x.a.tiers[x.lvl - 1].n} ${esc(x.a.unit)}` : esc(x.a.desc)}</small></div></div>`;
  modal({
    body: `
      <div class="congrats">
        <div class="congrats-ic">${list.length === 1 ? list[0].a.icon : '🏆'}</div>
        <h3>${list.length === 1 ? (list[0].lvl > 1 ? 'Szintet léptél!' : 'Új achievement!') : `${list.length} új achievement!`}</h3>
        ${list.slice(0, 6).map(item).join('')}
        ${list.length > 6 ? `<p class="hint">…és még ${list.length - 6}.</p>` : ''}
        <a class="btn block" href="#/achi" style="margin-top:6px">🏆 Megnézem az achievementjeimet</a>
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
