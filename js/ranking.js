// SZISZpong · Egyéni és páros ranglista
import { $app, esc, ranked, ratingOf, signed, state } from './core.js';
import { gamesOf, newsVisible, statsOf } from './data.js';
import { awardIcons } from './honors-ui.js';

/* ---------- Ranglisták (egyéni és páros) ---------- */
export function renderRanking(kind) {
  const list = ranked(kind);
  const played = list.filter((p) => gamesOf(p.id, kind) > 0);
  const showPodium = played.length >= 3 && list.slice(0, 3).every((p) => played.includes(p));
  const top = showPodium ? list.slice(0, 3) : [];
  const nMatches = state.matches.filter((m) => m.kind === kind).length;

  const row = (p, i) => {
    const me = p.id === state.me.id;
    const d = statsOf(p.id, kind).lastDelta;
    return `
      <a class="rank-row ${me ? 'me' : ''} p${i + 1}" href="#/profil/${p.id}">
        <div class="rank-pos">${i + 1}</div>
        <div class="rank-name">${esc(p.name)}${me ? '<span class="tag you">te</span>' : ''}<span class="aws">${awardIcons(p.id, kind)}</span></div>
        <div class="rank-elo"><strong>${ratingOf(p, kind)}</strong>${d != null ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${signed(d)}</span>` : ''}</div>
      </a>`;
  };

  $app.innerHTML = `
    ${newsVisible() ? `<div class="news"><span class="news-label">HÍR ÉS QUOTE</span>${esc(state.news.text)}</div>` : ''}
    <h1 class="page-title">${kind === 'doubles' ? 'Páros ranglista' : 'Egyéni ranglista'}</h1>
    <p class="page-sub">${list.length} játékos · ${nMatches} meccs</p>
    ${showPodium ? `
      <div class="podium">
        ${[1, 0, 2].map((i) => `
          <a class="podium-item g${i + 1}" href="#/profil/${top[i].id}">
            <span class="crown">${i === 0 ? '👑' : ''}</span>
            <div class="pname">${esc(top[i].name)}</div>
            <div class="pelo">${ratingOf(top[i], kind)}</div>
            <div class="podium-block">${i + 1}</div>
          </a>`).join('')}
      </div>` : ''}
    ${list.length ? `<div class="rank-list">${list.map(row).join('')}</div>`
      : `<div class="card empty"><span class="big">🏓</span>${kind === 'doubles' ? 'Még nem volt páros meccs. A ＋ gombbal rögzíthetsz egyet.' : 'Még senki nincs a listán.'}</div>`}
  `;
}
