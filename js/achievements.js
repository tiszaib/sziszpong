// SZISZpong · Achievementek oldal (bárki profiljáról megnyitható)
import { $app, esc, playerById, state } from './core.js';
import { ACH, ACH_LEVELS, TIER_COLORS, achLevels } from './honors.js';
import { achInfo, rarity } from './honors-ui.js';

export function renderAchievements(pid) {
  const p = playerById(pid);
  if (!p) { $app.innerHTML = '<div class="card empty"><span class="big">🤷</span>Nincs ilyen játékos.</div>'; return; }
  const own = p.id === state.me.id;
  const got = achLevels(p.id);
  const pct = Math.round((got / ACH_LEVELS) * 100);
  // helyezés achievement-szintekben az aktív, már játszott játékosok között
  const pool = state.players.filter((x) => x.active && (state.honors?.per.get(x.id)?.games || 0) > 0);
  const place = pool.filter((x) => achLevels(x.id) > got).length + 1;

  const card = (a) => {
    const x = achInfo(p.id, a);
    const multi = x.max > 1;
    const rare = rarity(a);
    const pips = multi ? `<span class="pips">${a.tiers.map((t, i) => `<i class="${i < x.level ? 'on' : ''}" style="--tc2:${TIER_COLORS[i][1]}"></i>`).join('')}</span>` : '';
    let line;
    if (x.done) line = multi ? '<span class="done">Legmagasabb szint elérve!</span>' : 'Megszerezve';
    else if (multi) line = `${x.value} / ${x.next.n} ${esc(a.unit)}${x.level && x.next.name !== x.name ? ` → ${esc(x.next.name)}` : ''}`;
    else line = esc(a.desc);
    const prog = !x.done && x.next && x.next.n > 1 ? Math.min(100, Math.round((x.value / x.next.n) * 100)) : null;
    return `
      <button type="button" class="ac ${x.level ? '' : 'off'}" data-ach="${a.id}" data-pid="${p.id}" style="--tc:${x.color ? x.color[1] : 'var(--border)'}">
        <span class="ac-ic">${a.icon}</span>
        <span class="ac-body">
          <span class="ac-nm">${esc(x.name)}${pips}</span>
          ${prog != null ? `<span class="pb"><i style="width:${prog}%"></i></span>` : ''}
          <span class="ac-meta"><span>${line}</span><span class="${rare <= 15 ? 'rare' : ''}">${rare <= 15 ? '💎 ' : ''}${rare}%</span></span>
        </span>
      </button>`;
  };

  const groups = [...new Set(ACH.map((a) => a.group))];
  $app.innerHTML = `
    <a class="back" href="#/profil/${p.id}">‹ ${own ? 'Profil' : esc(p.name) + ' profilja'}</a>
    <h1 class="page-title">🏆 Achievementek</h1>
    ${own ? '' : `<p class="page-sub">${esc(p.name)}</p>`}
    <div class="card">
      <div class="ach-sum">
        <div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
        <div><h2>${got} / ${ACH_LEVELS} szint</h2><p>${pool.length > 1 ? `Achievementekben: ${place}. hely (${pool.length} játékosból)${place <= 3 ? ' ' + ['🥇', '🥈', '🥉'][place - 1] : ''}` : ''}</p></div>
      </div>
      <div class="tiers-legend">${TIER_COLORS.map(([n, c]) => `<span style="--tc:${c}">${n}</span>`).join('')}</div>
    </div>
    <p class="hint" style="margin:10px 2px 0">Jobb oldalt: a játékosok hány %-ának van meg. 💎 = ritka (15% vagy kevesebb). Koppints egyre a részletekért.</p>
    ${groups.map((g) => `<div class="section-title">${esc(g)}</div>${ACH.filter((a) => a.group === g).map(card).join('')}`).join('')}
  `;
}
