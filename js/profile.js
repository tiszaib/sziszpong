// SZISZpong · Profil és ELO-grafikon
import { localLogout } from './auth.js';
import { $app, charts, esc, kindLabel, nameOf, playerById, ranked, sb, state, toast } from './core.js';
import { statsOf } from './data.js';
import { ACH_LEVELS, achLevels, awardOf } from './honors.js';
import { fold } from './honors-ui.js';
import { bindMatchCards, matchListByDay } from './matches.js';
import { duration } from './mystats.js';

/* ---------- Profil ---------- */
export function renderProfile(id) {
  const p = playerById(id);
  if (!p) { $app.innerHTML = '<div class="card empty"><span class="big">🤷</span>Nincs ilyen játékos.</div>'; return; }
  const s = statsOf(p.id, 'singles');
  const d = statsOf(p.id, 'doubles');
  const games = s.wins + s.losses;
  const dGames = d.wins + d.losses;
  const sPos = ranked('singles').findIndex((x) => x.id === p.id) + 1;
  const dRank = ranked('doubles');
  const dPos = dRank.findIndex((x) => x.id === p.id) + 1;
  const own = p.id === state.me.id;
  const myAwards = state.honors?.awardsOf.get(p.id) || [];
  const streak = (st) => (st.streak > 0 ? `${st.streak} GY` : st.streak < 0 ? `${-st.streak} V` : '–');
  const pct = (st) => { const n = st.wins + st.losses; return n ? Math.round((st.wins / n) * 100) + '%' : '–'; };
  const sortRec = (map) => [...map.entries()]
    .map(([other, r]) => ({ other, ...r, n: r.w + r.l }))
    .sort((a, b) => b.n - a.n || nameOf(a.other).localeCompare(nameOf(b.other), 'hu'));
  const h2h = sortRec(s.h2h);
  const partners = sortRec(d.partners);
  const recent = state.matches.filter((m) => m.winners.includes(p.id) || m.losers.includes(p.id)).slice(0, 10);
  const recTable = (rows) => `
    <div class="card" style="padding:4px 16px">
      <table class="h2h">${rows.map((r) => `
        <tr><td><a href="#/profil/${r.other}"><b>${esc(nameOf(r.other))}</b></a>
              <div class="bar"><i style="width:${Math.round((r.w / r.n) * 100)}%"></i></div></td>
            <td class="r">${r.w} – ${r.l}</td></tr>`).join('')}
      </table>
    </div>`;

  const kind = state.profileKind;
  const panel = (k) => {
    const st = k === 'singles' ? s : d;
    const n = st.wins + st.losses;
    if (!n) return `<div class="kpanel" data-k="${k}"><div class="card empty"><span class="big">🏓</span>Még nincs ${k === 'doubles' ? 'páros' : 'egyéni'} meccse.</div></div>`;
    const rows = k === 'singles' ? h2h : partners;
    return `
      <div class="kpanel" data-k="${k}">
        <div class="stats" style="margin-top:0">
          <div class="stat"><b>${n}</b><span>meccs</span></div>
          <div class="stat"><b style="color:var(--win)">${st.wins}</b><span>győzelem</span></div>
          <div class="stat"><b style="color:var(--loss)">${st.losses}</b><span>vereség</span></div>
          <div class="stat"><b>${pct(st)}</b><span>győzelmi arány</span></div>
          <div class="stat"><b>${st.best}</b><span>csúcs ELO</span></div>
          <div class="stat"><b>${streak(st)}</b><span>sorozat</span></div>
        </div>
        <div class="card chart-box" style="margin-top:10px"><canvas id="chart-${k === 'singles' ? 's' : 'd'}"></canvas></div>
        ${rows.length ? fold(k === 'singles' ? 'Egymás ellen' : 'Páros társak', rows.length, recTable(rows)) : ''}
      </div>`;
  };

  $app.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${esc(p.name.trim().charAt(0).toUpperCase())}</div>
      <div class="profile-name">${esc(p.name)}</div>
      ${p.active ? '' : '<div class="profile-rank">Nem aktív játékos</div>'}
    </div>
    ${myAwards.length ? `<div class="award-list">${myAwards.map((key) => {
      const a = awardOf(key);
      return `<button type="button" class="award" data-aw="${key}"><span class="award-ic">${a.icon}</span><span><b>${esc(a.name)}</b>${a.kind ? ` <i>${kindLabel(a.kind).toLowerCase()}</i>` : ''}<small>${esc(state.honors.current[key].text)}</small></span></button>`;
    }).join('')}</div>` : ''}

    <div class="elo-pair ktoggle" role="tablist">
      <button type="button" class="elo-box ${kind === 'singles' ? 'active' : ''}" data-pk="singles" role="tab"><span>Egyéni</span><b>${p.elo}</b><small>${sPos && p.active ? `${sPos}. hely` : '–'}</small></button>
      <button type="button" class="elo-box dbl ${kind === 'doubles' ? 'active' : ''}" data-pk="doubles" role="tab"><span>Páros</span><b>${dGames ? p.elo_doubles : '–'}</b><small>${dPos ? `${dPos}. hely` : 'még nem játszott'}</small></button>
    </div>
    <div class="kslider" id="kslider">
      <div class="ktrack ${kind === 'doubles' ? 'show-d' : ''}" id="ktrack">${panel('singles')}${panel('doubles')}</div>
    </div>

    ${own ? '<a class="btn block stats-btn" href="#/statok">📊 Statisztikáim</a>' : ''}
    <a class="btn block ach-btn" href="#/achi/${p.id}"><span>🏆 Achievementek</span><b>${achLevels(p.id)} / ${ACH_LEVELS} szint</b></a>

    ${recent.length ? `<div class="section-title">Utolsó meccsek</div>${matchListByDay(recent)}` : ''}

    ${own ? `
      <div class="section-title">Fiók</div>
      <div class="stack">
        ${state.me.is_admin ? '<a class="btn block" href="#/admin">👑 Admin</a>' : ''}
        <button class="btn danger block" id="logout">Kijelentkezés / fiókváltás</button>
      </div>` : ''}
  `;

  // Egyéni / Páros váltó: a doboz magassága mindig az aktuális panelhez igazodik
  const slider = $app.querySelector('#kslider');
  const track = $app.querySelector('#ktrack');
  const fit = () => {
    const pnl = track.querySelector(`.kpanel[data-k="${state.profileKind}"]`);
    if (pnl) slider.style.height = pnl.offsetHeight + 'px';
  };
  $app.querySelectorAll('[data-pk]').forEach((b) => {
    b.onclick = () => {
      state.profileKind = b.dataset.pk;
      $app.querySelectorAll('[data-pk]').forEach((x) => x.classList.toggle('active', x === b));
      track.classList.toggle('show-d', state.profileKind === 'doubles');
      fit();
    };
  });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(fit);
    track.querySelectorAll('.kpanel').forEach((x) => ro.observe(x));
  }
  fit();

  bindMatchCards();
  const lo = $app.querySelector('#logout');
  if (lo) lo.onclick = async () => {
    try { await sb.rpc('logout', { p_token: state.token }); } catch { /* mindegy */ }
    localLogout();
    toast('Kijelentkeztél.');
  };

  if (window.Chart) {
    const cs = $app.querySelector('#chart-s');
    if (cs) drawChart(cs, s.history, '#c6ff3d', 'rgba(198,255,61,');
    const cd = $app.querySelector('#chart-d');
    if (cd) drawChart(cd, d.history, '#ff7a1a', 'rgba(255,122,26,');
    fit();
  }
}

export function drawChart(canvas, history, color, rgbaPrefix) {
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8b8ba7';
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, rgbaPrefix + '.35)');
  grad.addColorStop(1, rgbaPrefix + '0)');
  const points = [{ at: null, elo: 1000 }, ...history];
  charts.push(new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map((h, i) => (i === 0 ? 'Start' : new Date(h.at).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }))),
      datasets: [{
        data: points.map((h) => h.elo),
        borderColor: color, backgroundColor: grad, fill: true, tension: 0.3,
        borderWidth: 3, pointRadius: points.length > 30 ? 0 : 3, pointBackgroundColor: color, pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: (c) => `${c.parsed.y} pont` } },
      },
      scales: {
        x: { ticks: { color: muted, maxTicksLimit: 6 }, grid: { display: false } },
        y: { ticks: { color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  }));
}
