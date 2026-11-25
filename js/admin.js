// SZISZpong · Admin oldal
import { $app, activePlayers, busy, byName, dateTime, esc, kindLabel, modal, nameOf, namesOf, playerById, rpc, state, toast } from './core.js';
import { gamesOf, loadAll } from './data.js';
import { scoreHTML } from './matches.js';

/* ---------- Admin ---------- */
export function renderAdmin() {
  const n = state.news || {};
  const act = activePlayers().sort(byName);
  const inactive = state.players.filter((p) => !p.active).sort(byName);
  const ms = state.matches.slice(0, state.adminMatchLimit);

  $app.innerHTML = `
    <h1 class="page-title">👑 Admin</h1>
    <p class="page-sub">Csak te látod ezt az oldalt.</p>

    <div class="section-title">Hír és quote</div>
    <form class="card" id="news-form">
      <label class="field"><span>Szöveg (a ranglisták tetején jelenik meg)</span>
        <textarea class="textarea" name="text" maxlength="500" placeholder="pl. Pénteken 20:00-kor kolis bajnokság! 🏆">${esc(n.text || '')}</textarea>
      </label>
      <label class="field"><span>Lejárat (nem kötelező, ezután a nap után eltűnik)</span>
        <input class="input" type="date" name="expires" value="${esc(n.expires_on || '')}">
      </label>
      <div class="btn-row">
        <button class="btn primary" type="submit" style="flex:1">Mentés</button>
        <button class="btn danger" type="button" id="news-clear">Doboz törlése</button>
      </div>
    </form>

    <div class="section-title">Kolis kód</div>
    <form class="card" id="code-form">
      <label class="field"><span>Új regisztrációs kód</span>
        <input class="input" name="code" autocomplete="off" autocapitalize="characters" placeholder="pl. M94" required>
      </label>
      <button class="btn" type="submit">Kód cseréje</button>
      <p class="hint">Csak az új regisztrációkhoz kell, a már bent lévőket nem érinti.</p>
    </form>

    <div class="section-title">Játékosok (${act.length})</div>
    <div class="card" style="padding:4px 16px">
      ${act.map((p) => `
        <div class="admin-row">
          <div class="who"><b>${esc(p.name)}${p.is_admin ? ' 👑' : ''}</b><small>${p.elo} egyéni · ${p.elo_doubles} páros · ${gamesOf(p.id, 'singles') + gamesOf(p.id, 'doubles')} meccs</small></div>
          <div class="btn-row">
            <button class="btn small" data-act="rename" data-id="${p.id}">Átnevez</button>
            <button class="btn small" data-act="pin" data-id="${p.id}">PIN</button>
            ${p.id === state.me.id ? '' : `<button class="btn small danger" data-act="remove" data-id="${p.id}">✕</button>`}
          </div>
        </div>`).join('') || '<div class="empty">Nincs játékos.</div>'}
    </div>
    ${inactive.length ? `
      <div class="section-title">Elrejtett játékosok</div>
      <div class="card" style="padding:4px 16px">
        ${inactive.map((p) => `
          <div class="admin-row">
            <div class="who"><b>${esc(p.name)}</b><small>a meccsei megmaradtak</small></div>
            <button class="btn small" data-act="restore" data-id="${p.id}">Visszaállítás</button>
          </div>`).join('')}
      </div>` : ''}

    <div class="section-title">Meccsek</div>
    <div class="card" style="padding:4px 16px">
      ${ms.map((m) => `
        <div class="admin-row">
          <div class="who"><b>🏆 ${esc(namesOf(m.winners))} – ${esc(namesOf(m.losers))}</b>
            <small>${kindLabel(m.kind)} · ${m.scoreW != null ? scoreHTML(m) + ' · ' : ''}${dateTime(m.at)}</small></div>
          <div class="btn-row">
            <button class="btn small" data-act="edit-match" data-id="${m.id}">Javít</button>
            <button class="btn small danger" data-act="del-match" data-id="${m.id}">✕</button>
          </div>
        </div>`).join('') || '<div class="empty">Még nincs meccs.</div>'}
    </div>
    ${state.matches.length > ms.length ? '<button class="btn block" id="more-matches" style="margin-top:10px">Korábbi meccsek</button>' : ''}
  `;

  const refresh = async (msg) => { await loadAll({ full: true }); renderAdmin(); if (msg) toast(msg, 'ok'); };

  const nf = $app.querySelector('#news-form');
  nf.onsubmit = (e) => {
    e.preventDefault();
    busy(nf.querySelector('[type=submit]'), async () => {
      await rpc('admin_set_news', { p_token: state.token, p_text: nf.elements.text.value, p_expires_on: nf.elements.expires.value || null });
      await refresh('Hír elmentve.');
    });
  };
  $app.querySelector('#news-clear').onclick = (e) => busy(e.currentTarget, async () => {
    await rpc('admin_set_news', { p_token: state.token, p_text: null, p_expires_on: null });
    await refresh('A doboz eltűnt a ranglistáról.');
  });

  const cf = $app.querySelector('#code-form');
  cf.onsubmit = (e) => {
    e.preventDefault();
    busy(cf.querySelector('[type=submit]'), async () => {
      await rpc('admin_set_reg_code', { p_token: state.token, p_code: cf.elements.code.value });
      cf.reset();
      toast('Új kolis kód beállítva.', 'ok');
    });
  };

  const more = $app.querySelector('#more-matches');
  if (more) more.onclick = () => { state.adminMatchLimit += 30; renderAdmin(); };

  $app.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => adminAction(b.dataset.act, b.dataset.id, refresh);
  });
}

export function adminAction(act, id, refresh) {
  const t = state.token;
  if (act === 'rename') {
    const p = playerById(id);
    modal({
      title: 'Átnevezés',
      body: `<label class="field"><span>Új név</span><input class="input" name="name" maxlength="20" value="${esc(p.name)}" required></label>`,
      onOk: async (f) => { await rpc('admin_rename_player', { p_token: t, p_player_id: id, p_name: f.elements.name.value }); await refresh('Átnevezve.'); },
    });
  } else if (act === 'pin') {
    modal({
      title: `Új PIN: ${nameOf(id)}`,
      text: 'Add meg az új PIN-t, és mondd meg neki.',
      body: '<label class="field"><span>Új 4 jegyű PIN</span><input class="input pin" name="pin" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off" required></label>',
      onOk: async (f) => { await rpc('admin_reset_pin', { p_token: t, p_player_id: id, p_pin: f.elements.pin.value }); toast('PIN beállítva.', 'ok'); },
    });
  } else if (act === 'remove') {
    const hasGames = gamesOf(id, 'singles') + gamesOf(id, 'doubles') > 0;
    modal({
      title: `${nameOf(id)} eltávolítása`,
      text: hasGames
        ? 'Már játszott meccset, ezért csak elrejtjük a ranglistáról. A meccsei megmaradnak, és bármikor visszaállíthatod.'
        : 'Még nem játszott, ezért a fiókja véglegesen törlődik.',
      okText: 'Eltávolítás', danger: true,
      onOk: async () => { await rpc('admin_remove_player', { p_token: t, p_player_id: id }); await refresh('Eltávolítva.'); },
    });
  } else if (act === 'restore') {
    busy(null, async () => { await rpc('admin_restore_player', { p_token: t, p_player_id: id }); await refresh('Visszaállítva.'); });
  } else if (act === 'del-match') {
    const m = state.matches.find((x) => x.id === id);
    modal({
      title: 'Meccs törlése',
      text: `${namesOf(m.winners)} – ${namesOf(m.losers)}${m.scoreW != null ? ' (' + scoreHTML(m) + ')' : ''}. A törlés után minden ELO-pont újraszámolódik.`,
      okText: 'Törlés', danger: true,
      onOk: async () => { await rpc('admin_delete_match', { p_token: t, p_match_id: id }); await refresh('Meccs törölve, pontok újraszámolva.'); },
    });
  } else if (act === 'edit-match') {
    const m = state.matches.find((x) => x.id === id);
    let winner = m.winnerSide;
    const form = modal({
      title: 'Meccs javítása',
      text: 'Mentés után minden ELO-pont újraszámolódik.',
      body: `
        <div class="field"><span>Eredmény (nem kötelező)</span>
          <div class="score-row">
            <input class="input score-in" name="s1" type="number" inputmode="numeric" min="0" max="99" placeholder="–" value="${m.score1 ?? ''}">
            <b>:</b>
            <input class="input score-in" name="s2" type="number" inputmode="numeric" min="0" max="99" placeholder="–" value="${m.score2 ?? ''}">
          </div>
          <div class="score-names"><span>${esc(namesOf(m.side1))}</span><span>${esc(namesOf(m.side2))}</span></div>
        </div>
        <div class="field"><span>Ki nyert?</span>
          <div class="winner-pick">${[1, 2].map((s) => `
            <button type="button" class="wp ${s === winner ? 'active' : ''}" data-s="${s}">${esc(namesOf(s === 1 ? m.side1 : m.side2))}</button>`).join('')}</div>
        </div>
        <label class="field"><span>Megjegyzés</span><textarea class="textarea" name="note" maxlength="300" rows="2">${esc(m.note || '')}</textarea></label>`,
      onOk: async (f) => {
        const a = f.elements.s1.value === '' ? null : Number(f.elements.s1.value);
        const b = f.elements.s2.value === '' ? null : Number(f.elements.s2.value);
        if (a != null && b != null && a !== b) winner = a > b ? 1 : 2;
        await rpc('admin_update_match', { p_token: t, p_match_id: id, p_winner_side: winner, p_score_1: a, p_score_2: b, p_note: f.elements.note.value || null });
        await refresh('Meccs javítva, pontok újraszámolva.');
      },
    });
    form.querySelectorAll('.wp').forEach((b) => {
      b.onclick = () => { winner = +b.dataset.s; form.querySelectorAll('.wp').forEach((x) => x.classList.toggle('active', x === b)); };
    });
  }
}
