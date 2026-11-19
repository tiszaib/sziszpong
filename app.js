/* =====================================================================
   SZISZpong – a koli pingpong ranglistája
   Felépítés:
     1. Segédfüggvények
     2. Adatok betöltése és statisztikák
     3. Képernyők (belépés, ranglista, élő, új meccs, profil, admin)
     4. Élő frissítés és indulás
   ===================================================================== */
(() => {
  'use strict';

  const CFG = window.SZISZ_CONFIG || {};
  const K = 32;                         // ELO K-szám (ugyanaz, mint az adatbázisban)
  const TOKEN_KEY = 'sziszpong.token';

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $toast = document.getElementById('toast');
  const $modal = document.getElementById('modal');
  const $live = document.getElementById('live');

  let sb = null;          // Supabase kliens
  let chart = null;       // a profil grafikonja
  const state = {
    token: null,
    me: null,
    players: [],
    matches: [],          // legújabb elöl
    news: null,
    stats: new Map(),
    view: null,
    feedLimit: 40,
    adminMatchLimit: 30,
    fresh: new Set(),     // frissen érkezett meccsek (animációhoz)
  };

  /* ------------------------------------------------------------------
     1. Segédfüggvények
     ------------------------------------------------------------------ */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* privát mód */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* privát mód */ } },
  };

  function eloDelta(winnerElo, loserElo) {
    return Math.max(1, Math.round(K * (1 - 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400)))));
  }

  const playerById = (id) => state.players.find((p) => p.id === id);
  const nameOf = (id) => playerById(id)?.name ?? 'Ismeretlen';
  const byName = (a, b) => a.name.localeCompare(b.name, 'hu');
  const activePlayers = () => state.players.filter((p) => p.active);
  const ranked = () => activePlayers().sort((a, b) => b.elo - a.elo || byName(a, b));
  const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');

  function localISODate(d = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function ago(iso) {
    const d = new Date(iso);
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 45) return 'most';
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} perce`;
    if (s < 6 * 3600) return `${Math.floor(s / 3600)} órája`;
    return d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const today = localISODate();
    const yest = localISODate(new Date(Date.now() - 86400000));
    const key = localISODate(d);
    if (key === today) return 'Ma';
    if (key === yest) return 'Tegnap';
    return d.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
  }

  let toastTimer = null;
  function toast(msg, kind = '') {
    $toast.textContent = msg;
    $toast.className = 'toast ' + kind;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.hidden = true; }, kind === 'error' ? 4200 : 2800);
  }

  // Supabase függvényhívás egységes hibakezeléssel
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      if (/Lejárt a belépésed/.test(error.message)) { localLogout(); }
      throw new Error(error.message || 'Hiba történt, próbáld újra.');
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // Gomb "dolgozik" állapotba, amíg fut a művelet
  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>'; }
    try { return await fn(); }
    catch (e) { toast(e.message, 'error'); return undefined; }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
  }

  // Egyszerű felugró ablak (megerősítés, szerkesztés)
  function modal({ title, text = '', body = '', okText = 'Mentés', danger = false, onOk }) {
    $modal.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${text ? `<p>${esc(text)}</p>` : ''}
        <form id="modal-form">${body}
          <div class="btn-row" style="margin-top:6px">
            <button type="button" class="btn ghost" data-close style="flex:1">Mégse</button>
            <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" style="flex:1">${esc(okText)}</button>
          </div>
        </form>
      </div>`;
    $modal.hidden = false;
    const close = () => { $modal.hidden = true; $modal.innerHTML = ''; };
    $modal.onclick = (e) => { if (e.target === $modal || e.target.closest('[data-close]')) close(); };
    const form = $modal.querySelector('#modal-form');
    form.querySelector('input,textarea,select')?.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ok = await busy(form.querySelector('[type=submit]'), async () => { await onOk(form); return true; });
      if (ok) close();
    };
    return form;
  }

  /* ------------------------------------------------------------------
     2. Adatok
     ------------------------------------------------------------------ */
  async function loadAll() {
    const [p, n] = await Promise.all([
      sb.from('players').select('id,name,elo,is_admin,active,created_at'),
      sb.from('news').select('text,expires_on').eq('id', 1).maybeSingle(),
    ]);
    if (p.error) throw p.error;
    let all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('matches')
        .select('id,played_at,kind,winner_side,score,recorded_by,match_players(player_id,side,elo_before,elo_after)')
        .order('played_at', { ascending: false })
        .range(from, from + 999);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < 1000) break;
    }
    state.players = p.data;
    state.news = n.data || null;
    state.matches = all.map(normalizeMatch).filter(Boolean);
    computeStats();
  }

  function normalizeMatch(m) {
    const w = m.match_players.find((x) => x.side === m.winner_side);
    const l = m.match_players.find((x) => x.side !== m.winner_side);
    if (!w || !l) return null;
    return {
      id: m.id, at: m.played_at, score: m.score, recordedBy: m.recorded_by,
      winner: w.player_id, loser: l.player_id,
      wAfter: w.elo_after, lAfter: l.elo_after,
      delta: w.elo_after - w.elo_before,
    };
  }

  function computeStats() {
    const S = new Map();
    for (const p of state.players) {
      S.set(p.id, { wins: 0, losses: 0, lastDelta: null, streak: 0, best: 1000, history: [], h2h: new Map() });
    }
    const h2h = (s, opp) => {
      if (!s.h2h.has(opp)) s.h2h.set(opp, { w: 0, l: 0 });
      return s.h2h.get(opp);
    };
    for (const m of [...state.matches].reverse()) {          // időrendben
      const w = S.get(m.winner); const l = S.get(m.loser);
      if (!w || !l) continue;
      w.wins++; l.losses++;
      w.lastDelta = m.delta; l.lastDelta = -m.delta;
      w.streak = w.streak > 0 ? w.streak + 1 : 1;
      l.streak = l.streak < 0 ? l.streak - 1 : -1;
      w.best = Math.max(w.best, m.wAfter);
      w.history.push({ at: m.at, elo: m.wAfter });
      l.history.push({ at: m.at, elo: m.lAfter });
      h2h(w, m.loser).w++; h2h(l, m.winner).l++;
    }
    state.stats = S;
  }

  const statsOf = (id) => state.stats.get(id) || { wins: 0, losses: 0, lastDelta: null, streak: 0, best: 1000, history: [], h2h: new Map() };

  function newsVisible() {
    const n = state.news;
    if (!n || !n.text) return false;
    return !n.expires_on || n.expires_on >= localISODate();
  }

  /* ------------------------------------------------------------------
     3. Képernyők
     ------------------------------------------------------------------ */
  function route() {
    if (chart) { chart.destroy(); chart = null; }
    $modal.hidden = true;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!state.me) { $nav.hidden = true; state.view = 'auth'; renderAuth(); return; }
    $nav.hidden = false;
    const page = parts[0] || '';
    if (page === 'elo') { state.view = 'feed'; renderFeed(); }
    else if (page === 'uj') { state.view = 'new'; renderNewMatch(); }
    else if (page === 'profil') { state.view = 'profile'; renderProfile(parts[1] || state.me.id); }
    else if (page === 'admin' && state.me.is_admin) { state.view = 'admin'; renderAdmin(); }
    else { state.view = 'ranking'; renderRanking(); }
    const navKey = state.view === 'admin' ? 'profile' : state.view;
    $nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
  }

  function rerenderIfLive() {
    if (['ranking', 'feed', 'profile'].includes(state.view) && $modal.hidden) {
      const y = window.scrollY;
      route();
      window.scrollTo(0, y);
    }
  }

  /* ---------- Belépés / regisztráció ---------- */
  function renderAuth(mode) {
    const list = activePlayers().sort(byName);
    mode = mode || (list.length ? 'login' : 'register');
    $app.innerHTML = `
      <h1 class="page-title">Szia! 🏓</h1>
      <p class="page-sub">Lépj be, vagy ha új vagy, regisztrálj a koli ranglistájára.</p>
      <div class="tabs">
        <button class="tab ${mode === 'login' ? 'active' : ''}" data-mode="login">Belépés</button>
        <button class="tab ${mode === 'register' ? 'active' : ''}" data-mode="register">Regisztráció</button>
      </div>
      <div class="card">
        ${mode === 'login' ? `
          <form id="login-form">
            <label class="field"><span>Ki vagy?</span>
              <select class="select" name="player" required>
                <option value="">Válaszd ki a neved…</option>
                ${list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field"><span>PIN-kód</span>
              <input class="input pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••" required>
            </label>
            <button class="btn primary block" type="submit">Belépés</button>
            <p class="hint">Elfelejtetted a PIN-ed? Szólj az adminnak, és ad újat.</p>
          </form>` : `
          <form id="reg-form">
            <label class="field"><span>Neved (ahogy a ranglistán látszódjon)</span>
              <input class="input" name="name" maxlength="20" autocomplete="nickname" placeholder="pl. Peti" required>
            </label>
            <label class="field"><span>Válassz egy 4 jegyű PIN-t</span>
              <input class="input pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••" required>
            </label>
            <label class="field"><span>PIN még egyszer</span>
              <input class="input pin" name="pin2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••" required>
            </label>
            <label class="field"><span>Kolis kód</span>
              <input class="input" name="code" autocomplete="off" autocapitalize="characters" placeholder="Kérdezd meg a többieket" required>
            </label>
            <button class="btn primary block" type="submit">Regisztráció</button>
            ${list.length ? '' : '<p class="hint">Te leszel az első játékos, így te leszel az admin is. 👑</p>'}
          </form>`}
      </div>`;

    $app.querySelectorAll('.tab').forEach((t) => { t.onclick = () => renderAuth(t.dataset.mode); });

    const lf = $app.querySelector('#login-form');
    if (lf) lf.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(lf);
      busy(lf.querySelector('[type=submit]'), async () => {
        const r = await rpc('login', { p_player_id: f.get('player'), p_pin: f.get('pin') });
        await afterLogin(r.token);
      });
    };
    const rf = $app.querySelector('#reg-form');
    if (rf) rf.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(rf);
      if (f.get('pin') !== f.get('pin2')) { toast('A két PIN nem egyezik.', 'error'); return; }
      busy(rf.querySelector('[type=submit]'), async () => {
        const r = await rpc('register', { p_name: f.get('name'), p_pin: f.get('pin'), p_code: f.get('code') });
        await loadAll();
        await afterLogin(r.token);
        toast('Üdv a ranglistán! 🎉', 'ok');
      });
    };
  }

  async function afterLogin(token) {
    state.token = token;
    store.set(TOKEN_KEY, token);
    state.me = await rpc('me', { p_token: token });
    location.hash = '#/';
    route();
  }

  function localLogout() {
    state.token = null; state.me = null;
    store.del(TOKEN_KEY);
    location.hash = '#/';
    route();
  }

  /* ---------- Ranglista ---------- */
  function renderRanking() {
    const list = ranked();
    const played = list.filter((p) => { const s = statsOf(p.id); return s.wins + s.losses > 0; });
    const showPodium = played.length >= 3 && list.slice(0, 3).every((p) => played.includes(p));
    const top = showPodium ? list.slice(0, 3) : [];

    const row = (p, i) => {
      const s = statsOf(p.id);
      const games = s.wins + s.losses;
      const me = p.id === state.me.id;
      const d = s.lastDelta;
      return `
        <a class="rank-row ${me ? 'me' : ''} p${i + 1}" href="#/profil/${p.id}">
          <div class="rank-pos">${i + 1}</div>
          <div style="min-width:0">
            <div class="rank-name">${esc(p.name)}${me ? '<span class="tag you">te</span>' : ''}${games ? '' : '<span class="tag new">új</span>'}</div>
            <div class="rank-meta">${s.wins} GY · ${s.losses} V${s.streak >= 3 ? ` · 🔥 ${s.streak}` : ''}</div>
          </div>
          <div class="rank-elo"><strong>${p.elo}</strong>${d != null ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${signed(d)}</span>` : ''}</div>
        </a>`;
    };

    $app.innerHTML = `
      ${newsVisible() ? `<div class="news"><span class="news-label">HÍR ÉS QUOTE</span>${esc(state.news.text)}</div>` : ''}
      <h1 class="page-title">Ranglista</h1>
      <p class="page-sub">${list.length} játékos · ${state.matches.length} meccs</p>
      ${showPodium ? `
        <div class="podium">
          ${[1, 0, 2].map((i) => `
            <a class="podium-item g${i + 1}" href="#/profil/${top[i].id}">
              <span class="crown">${i === 0 ? '👑' : ''}</span>
              <div class="pname">${esc(top[i].name)}</div>
              <div class="pelo">${top[i].elo}</div>
              <div class="podium-block">${i + 1}</div>
            </a>`).join('')}
        </div>` : ''}
      ${list.length ? `<div class="rank-list">${list.map(row).join('')}</div>`
        : '<div class="card empty"><span class="big">🏓</span>Még senki nincs a listán.</div>'}
    `;
  }

  /* ---------- Élő meccsfolyam ---------- */
  function matchCard(m) {
    const rec = m.recordedBy && m.recordedBy !== m.winner && m.recordedBy !== m.loser
      ? `<div class="rec">rögzítette: ${esc(nameOf(m.recordedBy))}</div>` : '';
    return `
      <div class="match ${state.fresh.has(m.id) ? 'fresh' : ''}">
        <div class="side winner">
          <a class="pl" href="#/profil/${m.winner}">${esc(nameOf(m.winner))}</a>
          <span class="delta up">${signed(m.delta)}</span>
        </div>
        <div class="mid">
          ${m.score ? `<div class="score">${esc(m.score)}</div>` : '<div class="vs">VS</div>'}
          <span class="when">${ago(m.at)}</span>
        </div>
        <div class="side right loser">
          <a class="pl" href="#/profil/${m.loser}">${esc(nameOf(m.loser))}</a>
          <span class="delta down">${signed(-m.delta)}</span>
        </div>
        ${rec}
      </div>`;
  }

  function matchListByDay(matches) {
    let html = ''; let last = '';
    for (const m of matches) {
      const label = dayLabel(m.at);
      if (label !== last) { html += `<div class="day-label">${esc(label)}</div>`; last = label; }
      html += matchCard(m) + '<div style="height:8px"></div>';
    }
    return html;
  }

  function renderFeed() {
    const list = state.matches.slice(0, state.feedLimit);
    $app.innerHTML = `
      <h1 class="page-title">Élő meccsfolyam</h1>
      <p class="page-sub">Minden meccs itt jelenik meg, amint valaki rögzíti.</p>
      ${list.length ? matchListByDay(list) : '<div class="card empty"><span class="big">📡</span>Még nincs meccs. Legyél te az első!</div>'}
      ${state.matches.length > list.length ? '<button class="btn block" id="more">Korábbi meccsek</button>' : ''}
    `;
    const more = $app.querySelector('#more');
    if (more) more.onclick = () => { state.feedLimit += 40; rerenderIfLive(); };
  }

  /* ---------- Új meccs ---------- */
  function renderNewMatch() {
    const list = activePlayers().sort(byName);
    const f = { p1: state.me.id, p2: '', winner: '', pinPlayer: '' };
    const opts = (sel, exclude) => `<option value="">Válassz…</option>` + list
      .filter((p) => p.id !== exclude)
      .map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.id === state.me.id ? ' (te)' : ''}</option>`).join('');

    $app.innerHTML = `
      <h1 class="page-title">Új meccs</h1>
      <p class="page-sub">Ki ki ellen játszott, és ki nyert?</p>
      <form class="card" id="nm">
        <label class="field"><span>Játékos 1</span><select class="select" name="p1"></select></label>
        <div class="vs-badge">VS</div>
        <label class="field"><span>Játékos 2</span><select class="select" name="p2"></select></label>
        <div class="field"><span style="display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px">Ki nyert?</span>
          <div class="winner-pick" id="wp"></div>
        </div>
        <div id="preview"></div>
        <label class="field"><span>Eredmény (nem kötelező)</span>
          <input class="input" name="score" maxlength="40" placeholder="pl. 11:7 vagy 3:1" autocomplete="off">
        </label>
        <div id="pinbox" hidden>
          <div class="field"><span style="display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px">
            Te nem játszottál ezen a meccsen, ezért az egyik játékos PIN-je kell. Ki írja be?</span>
            <div class="chips" id="pinwho"></div>
            <input class="input pin" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
          </div>
        </div>
        <button class="btn primary block" type="submit" id="save">Meccs rögzítése</button>
      </form>`;

    const form = $app.querySelector('#nm');
    const s1 = form.elements.p1; const s2 = form.elements.p2;

    const update = () => {
      s1.innerHTML = opts(f.p1, f.p2);
      s2.innerHTML = opts(f.p2, f.p1);
      const both = f.p1 && f.p2;
      if (f.winner && f.winner !== f.p1 && f.winner !== f.p2) f.winner = '';
      form.querySelector('#wp').innerHTML = [f.p1, f.p2].map((id, i) => `
        <button type="button" class="wp ${f.winner && f.winner === id ? 'active' : ''}" data-id="${id}" ${id ? '' : 'disabled'}>
          ${id ? esc(nameOf(id)) : `Játékos ${i + 1}`}<small>${f.winner && f.winner === id ? 'nyert 🏆' : 'nyert?'}</small>
        </button>`).join('');
      form.querySelectorAll('.wp').forEach((b) => { b.onclick = () => { if (b.dataset.id) { f.winner = b.dataset.id; update(); } }; });

      const pv = form.querySelector('#preview');
      if (both && f.winner) {
        const w = playerById(f.winner); const l = playerById(f.winner === f.p1 ? f.p2 : f.p1);
        const d = eloDelta(w.elo, l.elo);
        pv.innerHTML = `<div class="preview"><span>${esc(w.name)} <span class="delta up">${signed(d)}</span></span><span>${esc(l.name)} <span class="delta down">${signed(-d)}</span></span></div>`;
      } else pv.innerHTML = '';

      const needPin = both && f.p1 !== state.me.id && f.p2 !== state.me.id;
      form.querySelector('#pinbox').hidden = !needPin;
      if (needPin) {
        if (f.pinPlayer !== f.p1 && f.pinPlayer !== f.p2) f.pinPlayer = f.p1;
        form.querySelector('#pinwho').innerHTML = [f.p1, f.p2].map((id) =>
          `<button type="button" class="chip ${f.pinPlayer === id ? 'active' : ''}" data-id="${id}">${esc(nameOf(id))}</button>`).join('');
        form.querySelectorAll('#pinwho .chip').forEach((c) => { c.onclick = () => { f.pinPlayer = c.dataset.id; update(); }; });
      }
      form.querySelector('#save').disabled = !(both && f.winner);
    };

    s1.onchange = () => { f.p1 = s1.value; update(); };
    s2.onchange = () => { f.p2 = s2.value; update(); };
    update();

    form.onsubmit = (e) => {
      e.preventDefault();
      if (!(f.p1 && f.p2 && f.winner)) return;
      const loser = f.winner === f.p1 ? f.p2 : f.p1;
      const needPin = f.p1 !== state.me.id && f.p2 !== state.me.id;
      if (needPin && !/^\d{4}$/.test(form.elements.pin.value)) { toast('Írd be a 4 jegyű PIN-t.', 'error'); return; }
      busy(form.querySelector('#save'), async () => {
        const r = await rpc('record_match', {
          p_token: state.token, p_winner: f.winner, p_loser: loser,
          p_score: form.elements.score.value || null,
          p_pin_player: needPin ? f.pinPlayer : null,
          p_pin: needPin ? form.elements.pin.value : null,
        });
        state.fresh.add(r.match_id);
        await loadAll();
        toast(`Rögzítve! ${nameOf(f.winner)} ${signed(r.delta)} 🏓`, 'ok');
        location.hash = '#/elo';
      });
    };
  }

  /* ---------- Profil ---------- */
  function renderProfile(id) {
    const p = playerById(id);
    if (!p) { $app.innerHTML = '<div class="card empty"><span class="big">🤷</span>Nincs ilyen játékos.</div>'; return; }
    const s = statsOf(p.id);
    const games = s.wins + s.losses;
    const list = ranked();
    const pos = list.findIndex((x) => x.id === p.id) + 1;
    const own = p.id === state.me.id;
    const streak = s.streak > 0 ? `${s.streak} GY` : s.streak < 0 ? `${-s.streak} V` : '–';
    const h2h = [...s.h2h.entries()]
      .map(([opp, r]) => ({ opp, ...r, n: r.w + r.l }))
      .sort((a, b) => b.n - a.n || nameOf(a.opp).localeCompare(nameOf(b.opp), 'hu'));
    const recent = state.matches.filter((m) => m.winner === p.id || m.loser === p.id).slice(0, 10);

    $app.innerHTML = `
      <div class="profile-head">
        <div class="avatar">${esc(p.name.trim().charAt(0).toUpperCase())}</div>
        <div class="profile-name">${esc(p.name)}</div>
        <div class="profile-elo">${p.elo}</div>
        <div class="profile-rank">${p.active ? `${pos}. hely a ${list.length} játékosból` : 'Nem aktív játékos'}</div>
      </div>
      <div class="stats">
        <div class="stat"><b>${games}</b><span>meccs</span></div>
        <div class="stat"><b style="color:var(--win)">${s.wins}</b><span>győzelem</span></div>
        <div class="stat"><b style="color:var(--loss)">${s.losses}</b><span>vereség</span></div>
        <div class="stat"><b>${games ? Math.round((s.wins / games) * 100) + '%' : '–'}</b><span>győzelmi arány</span></div>
        <div class="stat"><b>${s.best}</b><span>csúcs ELO</span></div>
        <div class="stat"><b>${streak}</b><span>sorozat</span></div>
      </div>

      <div class="section-title">ELO alakulása</div>
      <div class="card chart-box">${s.history.length ? '<canvas id="elo-chart"></canvas>' : '<div class="empty">Még nincs meccse.</div>'}</div>

      ${h2h.length ? `
        <div class="section-title">Egymás ellen</div>
        <div class="card" style="padding:4px 16px">
          <table class="h2h">${h2h.map((r) => `
            <tr><td><a href="#/profil/${r.opp}"><b>${esc(nameOf(r.opp))}</b></a>
                  <div class="bar"><i style="width:${Math.round((r.w / r.n) * 100)}%"></i></div></td>
                <td class="r">${r.w} – ${r.l}</td></tr>`).join('')}
          </table>
        </div>` : ''}

      ${recent.length ? `<div class="section-title">Utolsó meccsek</div>${recent.map((m) => matchCard(m) + '<div style="height:8px"></div>').join('')}` : ''}

      ${own ? `
        <div class="section-title">Fiók</div>
        <div class="stack">
          ${state.me.is_admin ? '<a class="btn block" href="#/admin">👑 Admin</a>' : ''}
          <button class="btn danger block" id="logout">Kijelentkezés / fiókváltás</button>
        </div>` : ''}
    `;

    const lo = $app.querySelector('#logout');
    if (lo) lo.onclick = async () => {
      try { await sb.rpc('logout', { p_token: state.token }); } catch { /* mindegy */ }
      localLogout();
      toast('Kijelentkeztél.');
    };

    const cv = $app.querySelector('#elo-chart');
    if (cv && window.Chart) drawChart(cv, s.history);
  }

  function drawChart(canvas, history) {
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#c6ff3d';
    const muted = css.getPropertyValue('--muted').trim() || '#8b8ba7';
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, 'rgba(198,255,61,.35)');
    grad.addColorStop(1, 'rgba(198,255,61,0)');
    const points = [{ at: null, elo: 1000 }, ...history];
    chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map((h, i) => (i === 0 ? 'Start' : new Date(h.at).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }))),
        datasets: [{
          data: points.map((h) => h.elo),
          borderColor: accent, backgroundColor: grad, fill: true, tension: 0.3,
          borderWidth: 3, pointRadius: points.length > 30 ? 0 : 3, pointBackgroundColor: accent, pointHoverRadius: 6,
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
    });
  }

  /* ---------- Admin ---------- */
  function renderAdmin() {
    const n = state.news || {};
    const act = activePlayers().sort(byName);
    const inactive = state.players.filter((p) => !p.active).sort(byName);
    const ms = state.matches.slice(0, state.adminMatchLimit);

    $app.innerHTML = `
      <h1 class="page-title">👑 Admin</h1>
      <p class="page-sub">Csak te látod ezt az oldalt.</p>

      <div class="section-title">Hír és quote</div>
      <form class="card" id="news-form">
        <label class="field"><span>Szöveg (a ranglista tetején jelenik meg)</span>
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
            <div class="who"><b>${esc(p.name)}${p.is_admin ? ' 👑' : ''}</b><small>${p.elo} pont · ${statsOf(p.id).wins + statsOf(p.id).losses} meccs</small></div>
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
            <div class="who"><b>🏆 ${esc(nameOf(m.winner))} – ${esc(nameOf(m.loser))}</b>
              <small>${m.score ? esc(m.score) + ' · ' : ''}${new Date(m.at).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div>
            <div class="btn-row">
              <button class="btn small" data-act="edit-match" data-id="${m.id}">Javít</button>
              <button class="btn small danger" data-act="del-match" data-id="${m.id}">✕</button>
            </div>
          </div>`).join('') || '<div class="empty">Még nincs meccs.</div>'}
      </div>
      ${state.matches.length > ms.length ? '<button class="btn block" id="more-matches" style="margin-top:10px">Korábbi meccsek</button>' : ''}
    `;

    const refresh = async (msg) => { await loadAll(); renderAdmin(); if (msg) toast(msg, 'ok'); };

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

  function adminAction(act, id, refresh) {
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
      const hasGames = statsOf(id).wins + statsOf(id).losses > 0;
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
        text: `${nameOf(m.winner)} – ${nameOf(m.loser)}${m.score ? ' (' + m.score + ')' : ''}. A törlés után minden ELO-pont újraszámolódik.`,
        okText: 'Törlés', danger: true,
        onOk: async () => { await rpc('admin_delete_match', { p_token: t, p_match_id: id }); await refresh('Meccs törölve, pontok újraszámolva.'); },
      });
    } else if (act === 'edit-match') {
      const m = state.matches.find((x) => x.id === id);
      let winner = m.winner;
      const form = modal({
        title: 'Meccs javítása',
        text: 'Mentés után minden ELO-pont újraszámolódik.',
        body: `
          <div class="field"><span style="display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px">Ki nyert?</span>
            <div class="winner-pick">${[m.winner, m.loser].map((pid) => `
              <button type="button" class="wp ${pid === winner ? 'active' : ''}" data-id="${pid}">${esc(nameOf(pid))}</button>`).join('')}</div>
          </div>
          <label class="field"><span>Eredmény</span><input class="input" name="score" maxlength="40" value="${esc(m.score || '')}"></label>`,
        onOk: async (f) => {
          await rpc('admin_update_match', { p_token: t, p_match_id: id, p_winner: winner, p_score: f.elements.score.value || null });
          await refresh('Meccs javítva, pontok újraszámolva.');
        },
      });
      form.querySelectorAll('.wp').forEach((b) => {
        b.onclick = () => { winner = b.dataset.id; form.querySelectorAll('.wp').forEach((x) => x.classList.toggle('active', x === b)); };
      });
    }
  }

  /* ------------------------------------------------------------------
     4. Élő frissítés és indulás
     ------------------------------------------------------------------ */
  let reloadTimer = null;
  const incoming = new Set();

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try { await loadAll(); } catch { return; }
      for (const id of incoming) {
        state.fresh.add(id);
        const m = state.matches.find((x) => x.id === id);
        if (m && state.me && m.recordedBy !== state.me.id) {
          toast(`🏓 ${nameOf(m.winner)} nyert ${nameOf(m.loser)} ellen${m.score ? ' (' + m.score + ')' : ''}`);
        }
      }
      incoming.clear();
      if (state.me) {
        const meNow = playerById(state.me.id);
        if (meNow && !meNow.active) { localLogout(); return; }
      }
      rerenderIfLive();
      setTimeout(() => state.fresh.clear(), 2500);
    }, 400);
  }

  function subscribe() {
    sb.channel('sziszpong-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (p) => {
        if (p.eventType === 'INSERT' && p.new?.id) incoming.add(p.new.id);
        scheduleReload();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, scheduleReload)
      .subscribe((status) => $live.classList.toggle('on', status === 'SUBSCRIBED'));
  }

  function showFatal(title, text, retry = true) {
    $nav.hidden = true;
    $app.innerHTML = `
      <div class="card empty">
        <span class="big">😵</span>
        <b style="display:block;font-size:18px;color:var(--text);margin-bottom:6px">${esc(title)}</b>
        ${esc(text)}
        ${retry ? '<div style="margin-top:16px"><button class="btn primary" onclick="location.reload()">Újrapróbálom</button></div>' : ''}
      </div>`;
  }

  async function init() {
    if (!CFG.SUPABASE_URL || /IDE_JON/.test(CFG.SUPABASE_URL) || !window.supabase) {
      showFatal('Még nincs beállítva', 'A config.js fájlba be kell írni a Supabase adatait.', false);
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (window.Chart) { window.Chart.defaults.font.family = 'Outfit, system-ui, sans-serif'; }

    try {
      await loadAll();
    } catch (e) {
      showFatal('Nem érem el az adatbázist', 'Ellenőrizd a netet, és próbáld újra. (' + (e.message || e) + ')');
      return;
    }

    state.token = store.get(TOKEN_KEY);
    if (state.token) {
      try {
        const { data } = await sb.rpc('me', { p_token: state.token });
        state.me = data || null;
      } catch { state.me = null; }
      if (!state.me) { state.token = null; store.del(TOKEN_KEY); }
    }

    subscribe();
    window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
    // ha a telefon visszatér az apphoz, frissítünk (háttérben lemaradhatott valami)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
    // az "x perce" feliratok frissítése
    setInterval(() => { if (state.view === 'feed') rerenderIfLive(); }, 60000);
    route();
  }

  init();
})();
