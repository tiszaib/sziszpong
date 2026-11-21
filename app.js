/* =====================================================================
   SZISZpong – a koli pingpong ranglistája
   Felépítés:
     1. Segédfüggvények
     2. Adatok betöltése és statisztikák
     3. Képernyők (belépés, ranglisták, meccsek, új meccs, profil, admin)
     4. Élő frissítés és indulás
   ===================================================================== */
(() => {
  'use strict';

  const CFG = window.SZISZ_CONFIG || {};
  const K = 32;                         // ELO K-szám (ugyanaz, mint az adatbázisban)
  const TOKEN_KEY = 'sziszpong.token';
  const KIND_KEY = 'sziszpong.kind';

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $toast = document.getElementById('toast');
  const $modal = document.getElementById('modal');
  const $live = document.getElementById('live');

  let sb = null;          // Supabase kliens
  let charts = [];        // a profil grafikonjai
  const state = {
    token: null,
    me: null,
    players: [],
    matches: [],          // legújabb elöl
    news: null,
    stats: { singles: new Map(), doubles: new Map() },
    view: null,
    matchesKind: 'singles',  // Meccsek fül szűrője
    profileKind: 'singles',  // Profil: egyéni vagy páros statok
    newKind: 'singles',      // Új meccs: egyéni vagy páros
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
  const namesOf = (ids) => ids.map(nameOf).join(' & ');
  const byName = (a, b) => a.name.localeCompare(b.name, 'hu');
  const activePlayers = () => state.players.filter((p) => p.active);
  const ratingOf = (p, kind) => (kind === 'doubles' ? p.elo_doubles : p.elo);
  const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');
  const kindLabel = (kind) => (kind === 'doubles' ? 'Páros' : 'Egyéni');

  function ranked(kind) {
    let list = activePlayers();
    // a páros listán csak az szerepel, aki már játszott párost
    if (kind === 'doubles') list = list.filter((p) => gamesOf(p.id, 'doubles') > 0);
    return list.sort((a, b) => ratingOf(b, kind) - ratingOf(a, kind) || byName(a, b));
  }

  function localISODate(d = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  const clock = (iso) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  const dateTime = (iso) => new Date(iso).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function dayLabel(iso) {
    const d = new Date(iso);
    const key = localISODate(d);
    if (key === localISODate()) return 'Ma';
    if (key === localISODate(new Date(Date.now() - 86400000))) return 'Tegnap';
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

  function closeModal() { $modal.hidden = true; $modal.innerHTML = ''; document.querySelectorAll('.confetti').forEach((c) => c.remove()); }

  // Felugró ablak. onOk nélkül csak egy "Bezárás" gomb van rajta.
  function modal({ title, text = '', body = '', okText = 'Mentés', danger = false, onOk }) {
    $modal.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        ${text ? `<p>${esc(text)}</p>` : ''}
        <form id="modal-form">${body}
          <div class="btn-row" style="margin-top:6px">
            ${onOk ? `
              <button type="button" class="btn ghost" data-close style="flex:1">Mégse</button>
              <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" style="flex:1">${esc(okText)}</button>`
              : '<button type="button" class="btn block" data-close>Bezárás</button>'}
          </div>
        </form>
      </div>`;
    $modal.hidden = false;
    $modal.onclick = (e) => {
      if (e.target === $modal || e.target.closest('[data-close]')) closeModal();
      else if (e.target.closest('a[href^="#"]')) closeModal();
    };
    const form = $modal.querySelector('#modal-form');
    if (onOk) form.querySelector('input,textarea,select')?.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!onOk) return;
      const ok = await busy(form.querySelector('[type=submit]'), async () => { await onOk(form); return true; });
      if (ok) closeModal();
    };
    return form;
  }

  /* Kereshető névválasztó: a <select> megmarad (rejtve), fölé egy gomb kerül.
     Koppintásra feljön a névlista, felül egy keresővel: ahogy gépelsz, szűkül. */
  const fold2 = (t) => t.toLocaleLowerCase('hu').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function enhanceSelect(sel) {
    if (sel._pk) { sel._pk.sync(); return; }
    sel.classList.add('sr-select');
    sel.tabIndex = -1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'select picker';
    sel.after(btn);
    const sync = () => {
      const o = sel.selectedOptions[0];
      btn.textContent = o ? o.textContent : '';
      btn.classList.toggle('empty', !sel.value);
    };
    btn.onclick = () => openPicker(sel);
    sel._pk = { sync };
    sync();
  }

  function openPicker(sel) {
    const opts = [...sel.options].filter((o) => o.value);
    $modal.innerHTML = `
      <div class="modal-box picker-box" role="dialog" aria-modal="true">
        <input class="input" id="pk-q" type="search" placeholder="🔍 Kezdd el írni a nevet…" autocomplete="off" autocapitalize="off">
        <div class="pk-list" id="pk-list"></div>
        <button type="button" class="btn block ghost" data-close style="margin-top:10px">Mégse</button>
      </div>`;
    $modal.hidden = false;
    const q = $modal.querySelector('#pk-q');
    const list = $modal.querySelector('#pk-list');
    const draw = () => {
      const f = fold2(q.value.trim());
      const hit = opts.filter((o) => !f || fold2(o.textContent).includes(f));
      list.innerHTML = hit.map((o) => `<button type="button" class="pk-item ${o.value === sel.value ? 'on' : ''}" data-v="${esc(o.value)}">${esc(o.textContent)}</button>`).join('')
        || '<div class="empty" style="padding:18px">Nincs ilyen nevű játékos.</div>';
    };
    const choose = (v) => {
      closeModal();
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel._pk?.sync();
    };
    q.oninput = draw;
    q.onkeydown = (e) => { if (e.key === 'Enter') { const first = list.querySelector('.pk-item'); if (first) { e.preventDefault(); choose(first.dataset.v); } } };
    $modal.onclick = (e) => {
      const it = e.target.closest('.pk-item');
      if (it) choose(it.dataset.v);
      else if (e.target === $modal || e.target.closest('[data-close]')) closeModal();
    };
    draw();
    q.focus();
  }

  // Egyéni / Páros kapcsoló
  const kindSwitch = (current, id) => `
    <div class="tabs" id="${id}">
      <button type="button" class="tab ${current === 'singles' ? 'active' : ''}" data-kind="singles">Egyéni</button>
      <button type="button" class="tab ${current === 'doubles' ? 'active' : ''}" data-kind="doubles">Páros</button>
    </div>`;

  /* ------------------------------------------------------------------
     2. Adatok
     ------------------------------------------------------------------ */
  async function loadAll() {
    const [p, n] = await Promise.all([
      sb.from('players').select('id,name,elo,elo_doubles,is_admin,active,created_at'),
      sb.from('news').select('text,expires_on').eq('id', 1).maybeSingle(),
    ]);
    if (p.error) throw p.error;
    let all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('matches')
        .select('id,played_at,kind,winner_side,score_1,score_2,note,recorded_by,match_players(player_id,side,elo_before,elo_after)')
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
    computeHonors();
  }

  // Egy meccs egységes alakra hozása: győztes és vesztes oldal (1 vagy 2 játékos)
  function normalizeMatch(m) {
    const mp = m.match_players || [];
    const win = mp.filter((x) => x.side === m.winner_side);
    const lose = mp.filter((x) => x.side !== m.winner_side);
    if (!win.length || !lose.length) return null;
    const byNameId = (a, b) => nameOf(a).localeCompare(nameOf(b), 'hu');
    return {
      id: m.id, at: m.played_at, kind: m.kind, note: m.note, recordedBy: m.recorded_by,
      winnerSide: m.winner_side,
      winners: win.map((x) => x.player_id).sort(byNameId),
      losers: lose.map((x) => x.player_id).sort(byNameId),
      side1: mp.filter((x) => x.side === 1).map((x) => x.player_id),
      side2: mp.filter((x) => x.side === 2).map((x) => x.player_id),
      after: Object.fromEntries(mp.map((x) => [x.player_id, x.elo_after])),
      before: Object.fromEntries(mp.map((x) => [x.player_id, x.elo_before])),
      delta: win[0].elo_after - win[0].elo_before,
      scoreW: m.winner_side === 1 ? m.score_1 : m.score_2,
      scoreL: m.winner_side === 1 ? m.score_2 : m.score_1,
      score1: m.score_1, score2: m.score_2,
    };
  }

  const blankStats = () => ({ wins: 0, losses: 0, lastDelta: null, streak: 0, best: 1000, history: [], h2h: new Map(), partners: new Map() });

  function computeStats() {
    for (const kind of ['singles', 'doubles']) {
      const S = new Map();
      for (const p of state.players) S.set(p.id, blankStats());
      const bump = (map, key, field) => {
        if (!map.has(key)) map.set(key, { w: 0, l: 0 });
        map.get(key)[field]++;
      };
      for (const m of [...state.matches].reverse()) {          // időrendben
        if (m.kind !== kind) continue;
        for (const [ids, won] of [[m.winners, true], [m.losers, false]]) {
          for (const id of ids) {
            const s = S.get(id);
            if (!s) continue;
            if (won) { s.wins++; s.streak = s.streak > 0 ? s.streak + 1 : 1; }
            else { s.losses++; s.streak = s.streak < 0 ? s.streak - 1 : -1; }
            s.lastDelta = won ? m.delta : -m.delta;
            s.best = Math.max(s.best, m.after[id]);
            s.history.push({ at: m.at, elo: m.after[id] });
            for (const opp of (won ? m.losers : m.winners)) bump(s.h2h, opp, won ? 'w' : 'l');
            for (const mate of ids) if (mate !== id) bump(s.partners, mate, won ? 'w' : 'l');
          }
        }
      }
      state.stats[kind] = S;
    }
  }

  const statsOf = (id, kind = 'singles') => state.stats[kind].get(id) || blankStats();
  const gamesOf = (id, kind) => { const s = statsOf(id, kind); return s.wins + s.losses; };

  /* ------------------------------------------------------------------
     2b. Különdíjak és achievementek
     Minden a meccsekből számolódik: időrendben "lejátsszuk" a teljes
     történetet, így adatbázis-változás nélkül működik, és egy törölt
     meccs a hozzá tartozó achievementet is viszi.
     ------------------------------------------------------------------ */
  const DAY = 86400000;
  const GAME_STEPS = [[10, 'g10'], [20, 'g20'], [50, 'g50'], [100, 'g100'], [200, 'g200']];
  const STREAK_STEPS = [[3, 's3'], [5, 's5'], [7, 's7'], [10, 's10']];

  const ACH = [
    { id: 'first', icon: '🐣', name: 'Első labda', desc: 'Lejátszottad az első meccsed.' },
    { id: 'firstwin', icon: '🩸', name: 'Első vér', desc: 'Megnyerted az első meccsed.' },
    { id: 'firstdbl', icon: '🤝', name: 'Párban minden jobb', desc: 'Lejátszottad az első páros meccsed.' },
    { id: 'g10', icon: '🏓', name: 'KGY-termi újonc', desc: '10 meccs (egyéni és páros együtt).' },
    { id: 'g20', icon: '🎫', name: 'Klubtag', desc: '20 meccs (egyéni és páros együtt).' },
    { id: 'g50', icon: '🤪', name: 'Fanatikus', desc: '50 meccs (egyéni és páros együtt).' },
    { id: 'g100', icon: '🏛️', name: 'Kolis legenda', desc: '100 meccs (egyéni és páros együtt).' },
    { id: 'g200', icon: '♾️', name: 'Örökös tag', desc: '200 meccs (egyéni és páros együtt).' },
    { id: 's3', icon: '🛝', name: 'Csusza', desc: '3 győzelem zsinórban (egyéniben vagy párosban).' },
    { id: 's5', icon: '⚡', name: 'Megállíthatatlan', desc: '5 győzelem zsinórban (egyéniben vagy párosban).' },
    { id: 's7', icon: '🤷', name: '67', desc: '7 győzelem zsinórban (egyéniben vagy párosban).' },
    { id: 's10', icon: '😈', name: 'Menace to society', desc: '10 győzelem zsinórban (egyéniben vagy párosban).' },
    { id: 'throne', icon: '👑', name: 'VZS-trónfosztó', desc: 'Voltál már 1. helyen az egyéni ranglistán.' },
    { id: 'throne_d', icon: '👯', name: 'Couple goals', desc: 'Voltál már 1. helyen a páros ranglistán.' },
    { id: 'bagel', icon: '🍞', name: 'Mászatott', desc: '11:0-ra nyertél egy meccset.' },
    { id: 'nusi', icon: '🫠', name: 'Nusi néni', desc: '11:0-ra kikaptál egy meccsen.' },
    { id: 'king', icon: '🗡️', name: 'Királygyilkos', desc: 'Egyéniben legyőzted az akkori 1. helyezettet.' },
    { id: 'stonks', icon: '📈', name: 'Stonks', desc: 'Egy meccsen +25 pontot vagy többet szereztél.' },
    { id: 'friend', icon: '🌍', name: 'Mindenki barátja', desc: 'Minden aktív játékos ellen játszottál már (aktív: volt meccse az elmúlt 2 hétben).' },
    { id: 'lotyo', icon: '💞', name: 'Páros lotyó', desc: '5 különböző páros társ.' },
    { id: 'night', icon: '🦉', name: 'DB-n emlegetett személy', desc: '10 meccs éjfél és hajnali 5 között.' },
    { id: 'early', icon: '☀️', name: 'Early Bird', desc: 'Meccs reggel 5 és 8 között.' },
    { id: 'weekend', icon: '🏠', name: 'Hétvégi bentlakó', desc: '10 meccs hétvégén.' },
  ];

  // Különdíjak. "both" = egy díj a két ranglistára együtt, különben egyéniben és párosban külön.
  const AWARDS = {
    magyar: { icon: '🇭🇺', name: 'A legnagyobb magyar', both: true, rule: 'Egyszerre vezeti az egyéni és a páros ranglistát. Ha nincs ilyen ember, senki nem kapja meg.' },
    verhetetlen: { icon: '🔥', name: 'Verhetetlen', rule: 'A leghosszabb jelenlegi győzelmi sorozat (legalább 3).' },
    feltorekvo: { icon: '🚀', name: 'Feltörekvő', rule: 'Aki 14 napja még 1000 pont alatt volt, és azóta a legtöbbet javított (legalább +30).' },
    unemployed: { icon: '🛋️', name: 'The unemployed friend', both: true, rule: 'A legtöbb meccs az elmúlt 7 napban (egyéni és páros együtt, legalább 3).' },
    feketelo: { icon: '🐎', name: 'Fekete ló', rule: 'Az elmúlt 7 nap legnagyobb meglepetés-győzelme: a legnagyobb pontkülönbséggel erősebb ellenfél legyőzése (legalább 50).' },
    nyugalom: { icon: '🧘', name: 'Nyugalom szigete', rule: 'A legjobb győzelmi arány a szoros meccseken, vagyis ahol 10:10 után tiebreak jött. Legalább 5 ilyen meccs kell hozzá.' },
    adomanyozo: { icon: '🎁', name: 'ELO adományozó', rule: 'A legtöbb elvesztett pont az elmúlt 7 napban.' },
  };
  const awardKeys = (kind) => Object.keys(AWARDS).map((a) => (AWARDS[a].both ? a : `${a}:${kind}`));
  const awardOf = (key) => { const [a, kind] = key.split(':'); return { ...AWARDS[a], kind: kind || null }; };

  function computeHonors() {
    const chrono = [...state.matches].reverse();
    const active = new Set(activePlayers().map((p) => p.id));
    const KINDS = ['singles', 'doubles'];
    const mk = () => ({ singles: new Map(), doubles: new Map() });
    const rating = mk(); const played = mk(); const streak = mk(); const close = mk(); const throne = mk();
    const lead = { singles: { id: null, since: 0 }, doubles: { id: null, since: 0 } };
    const ach = new Map();
    const lastPlayed = new Map();   // aktív = volt meccse az elmúlt 14 napban
    const recent = (id, t) => active.has(id) && (lastPlayed.get(id) ?? -Infinity) > t - 14 * DAY;
    const per = new Map();
    const events = [];
    let holders = {};

    const give = (pid, aid, at) => {
      if (!ach.has(pid)) ach.set(pid, new Map());
      if (!ach.get(pid).has(aid)) ach.get(pid).set(aid, at);
    };
    const P = (pid) => {
      if (!per.has(pid)) per.set(pid, { games: 0, night: 0, weekend: 0, partners: new Set(), opp: new Map(), best: { singles: 0, doubles: 0 } });
      return per.get(pid);
    };
    const leaderOf = (kind) => {
      let best = null; let top = -Infinity; let tie = false;
      for (const [id, n] of played[kind]) {
        if (!n || !active.has(id)) continue;
        const r = rating[kind].get(id);
        if (r > top) { top = r; best = id; tie = false; } else if (r === top) tie = true;
      }
      return tie ? null : best;
    };
    const avgBefore = (m, ids) => ids.reduce((t, id) => t + (m.before[id] ?? 1000), 0) / ids.length;

    // Ki viszi a díjat t időpontban? (i = az utolsó már lejátszott meccs indexe)
    function evalAwards(t, i, prev) {
      const res = {};
      const w7 = []; const w14 = [];
      for (let j = i; j >= 0; j--) {
        const x = chrono[j]; const tx = Date.parse(x.at);
        if (tx <= t - 14 * DAY) break;
        w14.push(x);
        if (tx > t - 7 * DAY) w7.push(x);
      }
      // a legnagyobb értékű nyer; egyenlőségnél marad a régi gazda
      const pick = (key, scores, min, text) => {
        let best = -Infinity; let cands = [];
        for (const [id, v] of scores) {
          if (!recent(id, t) || v < min) continue;
          if (v > best) { best = v; cands = [id]; } else if (v === best) cands.push(id);
        }
        if (!cands.length) return;
        const inc = prev[key]?.ids[0];
        const id = cands.includes(inc) ? inc : cands[0];
        res[key] = { ids: [id], text: text(best, id) };
      };

      const ls = leaderOf('singles');
      if (ls && ls === leaderOf('doubles')) res.magyar = { ids: [ls], text: 'Egyéniben és párosban is ő az első.' };

      const cnt = new Map();
      for (const x of w7) for (const id of [...x.winners, ...x.losers]) cnt.set(id, (cnt.get(id) || 0) + 1);
      pick('unemployed', cnt, 3, (v) => `${v} meccs az elmúlt 7 napban`);

      for (const k of KINDS) {
        pick(`verhetetlen:${k}`, streak[k], 3, (v) => `${v} győzelem zsinórban`);

        const start = new Map();
        for (const x of w14) if (x.kind === k) for (const id of [...x.winners, ...x.losers]) start.set(id, x.before[id]);
        const gain = new Map();
        for (const [id, s] of start) if (s < 1000) gain.set(id, rating[k].get(id) - s);
        pick(`feltorekvo:${k}`, gain, 30, (v, id) => `+${v} pont 14 nap alatt (${start.get(id)} pontról indult)`);

        let up = null;
        for (const x of w7) {
          if (x.kind !== k || !x.winners.every((id) => recent(id, t))) continue;
          const gap = Math.round(avgBefore(x, x.losers) - avgBefore(x, x.winners));
          if (gap < 50) continue;
          const inc = prev[`feketelo:${k}`]?.matchId === x.id;
          if (!up || gap > up.gap || (gap === up.gap && inc)) up = { gap, x };
        }
        if (up) res[`feketelo:${k}`] = { ids: up.x.winners, matchId: up.x.id, text: `${up.gap} ponttal erősebb ellenfelet győzött le (${namesOf(up.x.losers)})` };

        const rate = new Map();
        for (const [id, c] of close[k]) if (c.n >= 5) rate.set(id, c.w / c.n);
        pick(`nyugalom:${k}`, rate, 0, (v, id) => `${Math.round(v * 100)}% a szoros meccseken (${close[k].get(id).w}/${close[k].get(id).n})`);

        const lost = new Map();
        for (const x of w7) if (x.kind === k) for (const id of x.losers) lost.set(id, (lost.get(id) || 0) + x.delta);
        pick(`adomanyozo:${k}`, lost, 1, (v) => `−${v} pont az elmúlt 7 napban`);
      }
      return res;
    }

    chrono.forEach((m, i) => {
      const k = m.kind; const t = Date.parse(m.at);
      const king = k === 'singles' ? leaderOf('singles') : null;
      const d = new Date(m.at); const h = d.getHours(); const wd = d.getDay();
      const closeGame = isTiebreak(m);
      for (const [ids, won] of [[m.winners, true], [m.losers, false]]) {
        for (const id of ids) {
          rating[k].set(id, m.after[id]);
          played[k].set(id, (played[k].get(id) || 0) + 1);
          const s = streak[k].get(id) || 0;
          const ns = won ? (s > 0 ? s + 1 : 1) : (s < 0 ? s - 1 : -1);
          streak[k].set(id, ns);
          const p = P(id);
          p.games++;
          if (ns > p.best[k]) p.best[k] = ns;
          give(id, 'first', m.at);
          if (won) give(id, 'firstwin', m.at);
          if (k === 'doubles') give(id, 'firstdbl', m.at);
          for (const [n, a] of GAME_STEPS) if (p.games >= n) give(id, a, m.at);
          for (const [n, a] of STREAK_STEPS) if (ns >= n) give(id, a, m.at);
          if (m.scoreW === 11 && m.scoreL === 0) give(id, won ? 'bagel' : 'nusi', m.at);
          if (won && m.delta >= 25) give(id, 'stonks', m.at);
          if (won && king && m.losers[0] === king) give(id, 'king', m.at);
          if (h < 5 && ++p.night >= 10) give(id, 'night', m.at);
          if (h >= 5 && h < 8) give(id, 'early', m.at);
          if ((wd === 0 || wd === 6) && ++p.weekend >= 10) give(id, 'weekend', m.at);
          if (k === 'doubles') {
            for (const mate of ids) if (mate !== id) p.partners.add(mate);
            if (p.partners.size >= 5) give(id, 'lotyo', m.at);
          }
          for (const o of (won ? m.losers : m.winners)) if (!p.opp.has(o)) p.opp.set(o, m.at);
          if (closeGame) {
            const c = close[k].get(id) || { w: 0, n: 0 };
            c.n++; if (won) c.w++;
            close[k].set(id, c);
          }
        }
      }
      // Mindenki barátja: az akkor aktív (2 hétben játszó) összes játékos ellen játszott már
      for (const id of [...m.winners, ...m.losers]) lastPlayed.set(id, t);
      for (const id of [...m.winners, ...m.losers]) {
        const p = per.get(id);
        const others = [...lastPlayed.keys()].filter((o) => o !== id && recent(o, t));
        if (others.length >= 3 && others.every((o) => p.opp.has(o))) give(id, 'friend', m.at);
      }

      // első hely változása (VZS-trónfosztó és trónon töltött idő)
      const L = lead[k]; const now = leaderOf(k);
      if (now !== L.id) {
        if (L.id) throne[k].set(L.id, (throne[k].get(L.id) || 0) + t - L.since);
        L.id = now; L.since = t;
      }
      if (now) give(now, k === 'singles' ? 'throne' : 'throne_d', m.at);

      // különdíjak gazdaváltása
      const next = evalAwards(t, i, holders);
      for (const key of Object.keys(next)) {
        const from = holders[key]?.ids || [];
        if (from.slice().sort().join() === next[key].ids.slice().sort().join()) continue;
        events.push({ at: m.at, matchId: m.id, key, kind: awardOf(key).kind, from, to: next[key].ids });
      }
      holders = next;
    });


    const nowT = Date.now();
    const throneNow = mk();
    for (const k of KINDS) {
      for (const [id, ms] of throne[k]) throneNow[k].set(id, ms);
      const L = lead[k];
      if (L.id) throneNow[k].set(L.id, (throneNow[k].get(L.id) || 0) + Math.max(0, nowT - L.since));
    }

    const byMatch = new Map();
    for (const e of events) {
      if (!byMatch.has(e.matchId)) byMatch.set(e.matchId, []);
      byMatch.get(e.matchId).push(e);
    }
    const current = evalAwards(nowT, chrono.length - 1, holders);
    const awardsOf = new Map();
    for (const [key, v] of Object.entries(current)) {
      for (const id of v.ids) {
        if (!awardsOf.has(id)) awardsOf.set(id, []);
        awardsOf.get(id).push(key);
      }
    }
    state.honors = { ach, events, byMatch, current, awardsOf, throne: throneNow, per, close, leader: { singles: lead.singles.id, doubles: lead.doubles.id } };
  }

  // Szoros meccs: 10:10 után tiebreak (a vesztes is legalább 10 pontot szerzett)
  function isTiebreak(m) { return m.scoreW != null && m.scoreL >= 10; }

  const achOf = (pid) => state.honors?.ach.get(pid) || new Map();

  function newsVisible() {
    const n = state.news;
    if (!n || !n.text) return false;
    return !n.expires_on || n.expires_on >= localISODate();
  }

  /* ------------------------------------------------------------------
     3. Képernyők
     ------------------------------------------------------------------ */
  function route() {
    charts.forEach((c) => c.destroy()); charts = [];
    closeModal();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!state.me) { $nav.hidden = true; state.view = 'auth'; renderAuth(); return; }
    $nav.hidden = false;
    const page = parts[0] || '';
    if (page === 'paros') { state.view = 'doubles'; renderRanking('doubles'); }
    else if (page === 'meccsek') { state.view = 'matches'; renderMatches(); }
    else if (page === 'uj') { state.view = 'new'; renderNewMatch(); }
    else if (page === 'profil') { state.view = 'profile'; renderProfile(parts[1] || state.me.id); }
    else if (page === 'statok') { state.view = 'stats'; renderMyStats(); }
    else if (page === 'admin' && state.me.is_admin) { state.view = 'admin'; renderAdmin(); }
    else { state.view = 'singles'; renderRanking('singles'); }
    const navKey = ['admin', 'stats'].includes(state.view) ? 'profile' : state.view;
    $nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
    setTimeout(checkNewAchievements, 0);
  }

  function rerenderIfLive() {
    if (['singles', 'doubles', 'matches', 'profile', 'stats'].includes(state.view) && $modal.hidden) {
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
    const ls = $app.querySelector('#login-form [name=player]');
    if (ls) enhanceSelect(ls);

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

  /* ---------- Ranglisták (egyéni és páros) ---------- */
  function renderRanking(kind) {
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

  /* ---------- Meccsek ---------- */
  const scoreHTML = (m) => (m.scoreW != null ? `${m.scoreW}:${m.scoreL}` : '');

  function matchCard(m) {
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

  function matchListByDay(matches, bands = false) {
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

  function bindMatchCards(root = $app) {
    root.querySelectorAll('[data-match]').forEach((el) => { el.onclick = () => openMatch(el.dataset.match); });
  }

  function renderMatches() {
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
  function headToHead(m) {
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

  function openMatch(id) {
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
          ? `<p class="hint" style="text-align:center">rögzítette: ${esc(nameOf(m.recordedBy))}</p>` : ''}`,
    });
  }

  /* ---------- Új meccs ---------- */
  function renderNewMatch() {
    const kind = state.newKind;
    const dbl = kind === 'doubles';
    const list = activePlayers().sort(byName);
    // f.sides[0] = 1. oldal, f.sides[1] = 2. oldal; egyéniben 1-1, párosban 2-2 hely
    const f = { sides: dbl ? [[state.me.id, ''], ['', '']] : [[state.me.id], ['']], winner: 0, pinPlayer: '' };
    const chosen = () => f.sides.flat().filter(Boolean);

    const slot = (s, i) => `
      <select class="select" data-side="${s}" data-slot="${i}" aria-label="${s + 1}. oldal, ${i + 1}. játékos"></select>`;

    $app.innerHTML = `
      <h1 class="page-title">Új meccs</h1>
      ${kindSwitch(kind, 'nk')}
      <form class="card" id="nm">
        <div class="field"><span>${dbl ? '1. csapat' : 'Játékos 1'}</span><div class="slots">${f.sides[0].map((_, i) => slot(0, i)).join('')}</div></div>
        <div class="vs-badge">VS</div>
        <div class="field"><span>${dbl ? '2. csapat' : 'Játékos 2'}</span><div class="slots">${f.sides[1].map((_, i) => slot(1, i)).join('')}</div></div>

        <div class="field"><span>Eredmény</span>
          <div class="score-row">
            <input class="input score-in" name="s1" type="number" inputmode="numeric" min="0" max="99" placeholder="–">
            <b>:</b>
            <input class="input score-in" name="s2" type="number" inputmode="numeric" min="0" max="99" placeholder="–">
          </div>
          <div class="score-names"><span id="sn1"></span><span id="sn2"></span></div>
        </div>

        <div class="field" id="wpbox"><span>Ki nyert?</span><div class="winner-pick" id="wp"></div></div>
        <div id="preview"></div>

        <label class="field"><span>Megjegyzés (nem kötelező)</span>
          <textarea class="textarea" name="note" maxlength="300" rows="2" placeholder="pl. Döntő szett 12:10-zel, visszavágót! 🔥"></textarea>
        </label>

        <div id="pinbox" hidden>
          <div class="field"><span>Te nem játszottál ezen a meccsen, ezért az egyik játékos PIN-je kell. Ki írja be?</span>
            <div class="chips" id="pinwho"></div>
            <input class="input pin" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
          </div>
        </div>
        <button class="btn primary block" type="submit" id="save">Meccs rögzítése</button>
      </form>`;

    $app.querySelectorAll('#nk .tab').forEach((t) => {
      t.onclick = () => { if (state.newKind !== t.dataset.kind) { state.newKind = t.dataset.kind; renderNewMatch(); } };
    });

    const form = $app.querySelector('#nm');
    const selects = [...form.querySelectorAll('select[data-side]')];
    const s1 = form.elements.s1; const s2 = form.elements.s2;
    const sideName = (s) => (f.sides[s].every(Boolean) ? namesOf(f.sides[s]) : (dbl ? `${s + 1}. csapat` : `Játékos ${s + 1}`));
    const scores = () => {
      const a = s1.value === '' ? null : Number(s1.value);
      const b = s2.value === '' ? null : Number(s2.value);
      return [a, b];
    };

    const update = () => {
      // választók: aki már ki van választva máshol, az nem jelenik meg
      for (const sel of selects) {
        const s = +sel.dataset.side; const i = +sel.dataset.slot;
        const mine = f.sides[s][i];
        const taken = new Set(chosen().filter((id) => id !== mine));
        sel.innerHTML = '<option value="">Válassz…</option>' + list.filter((p) => !taken.has(p.id))
          .map((p) => `<option value="${p.id}" ${p.id === mine ? 'selected' : ''}>${esc(p.name)}${p.id === state.me.id ? ' (te)' : ''}</option>`).join('');
      }
      selects.forEach(enhanceSelect);
      const full = f.sides.every((side) => side.every(Boolean));
      form.querySelector('#sn1').textContent = sideName(0);
      form.querySelector('#sn2').textContent = sideName(1);

      // ha mindkét pontszám megvan, abból dől el a győztes
      const [a, b] = scores();
      const byScore = a != null && b != null && a !== b;
      f.winner = byScore ? (a > b ? 1 : 2) : 0;   // a győztest mindig a pontszám dönti el
      form.querySelector('#wpbox').hidden = true;
      form.querySelector('#wp').innerHTML = [1, 2].map((s) => `
        <button type="button" class="wp ${f.winner === s ? 'active' : ''}" data-s="${s}" ${full ? '' : 'disabled'}>
          ${esc(sideName(s - 1))}<small>${f.winner === s ? 'nyert 🏆' : 'nyert?'}</small>
        </button>`).join('');
      form.querySelectorAll('.wp').forEach((btn) => { btn.onclick = () => { f.winner = +btn.dataset.s; update(); }; });

      const pv = form.querySelector('#preview');
      if (full && f.winner) {
        const W = f.sides[f.winner - 1]; const L = f.sides[2 - f.winner];
        const avg = (ids) => ids.reduce((t, id) => t + ratingOf(playerById(id), kind), 0) / ids.length;
        const d = eloDelta(Math.round(avg(W)), Math.round(avg(L)));
        pv.innerHTML = `<div class="preview"><span>${esc(namesOf(W))} <span class="delta up">${signed(d)}</span></span><span>${esc(namesOf(L))} <span class="delta down">${signed(-d)}</span></span></div>`;
      } else pv.innerHTML = '';

      const needPin = full && !chosen().includes(state.me.id);
      form.querySelector('#pinbox').hidden = !needPin;
      if (needPin) {
        if (!chosen().includes(f.pinPlayer)) f.pinPlayer = chosen()[0];
        form.querySelector('#pinwho').innerHTML = chosen().map((id) =>
          `<button type="button" class="chip ${f.pinPlayer === id ? 'active' : ''}" data-id="${id}">${esc(nameOf(id))}</button>`).join('');
        form.querySelectorAll('#pinwho .chip').forEach((c) => { c.onclick = () => { f.pinPlayer = c.dataset.id; update(); }; });
      }
      form.querySelector('#save').disabled = !(full && f.winner);
    };

    selects.forEach((sel) => { sel.onchange = () => { f.sides[+sel.dataset.side][+sel.dataset.slot] = sel.value; update(); }; });
    s1.oninput = update; s2.oninput = update;
    update();

    form.onsubmit = (e) => {
      e.preventDefault();
      const [a, b] = scores();
      if (a == null || b == null) { toast('Írd be mindkét pontszámot.', 'error'); return; }
      if (a === b) { toast('Döntetlen nem lehet.', 'error'); return; }
      if (Math.min(a, b) >= 10 && Math.abs(a - b) !== 2) { toast('10:10 után kettővel kell nyerni (pl. 12:10).', 'error'); return; }
      if (!f.winner) return;
      const W = f.sides[f.winner - 1]; const L = f.sides[2 - f.winner];
      const sW = f.winner === 1 ? a : b; const sL = f.winner === 1 ? b : a;
      const needPin = !chosen().includes(state.me.id);
      if (needPin && !/^\d{4}$/.test(form.elements.pin.value)) { toast('Írd be a 4 jegyű PIN-t.', 'error'); return; }
      const common = {
        p_token: state.token, p_score_w: sW, p_score_l: sL, p_note: form.elements.note.value || null,
        p_pin_player: needPin ? f.pinPlayer : null, p_pin: needPin ? form.elements.pin.value : null,
      };
      busy(form.querySelector('#save'), async () => {
        const r = dbl
          ? await rpc('record_doubles', { ...common, p_w1: W[0], p_w2: W[1], p_l1: L[0], p_l2: L[1] })
          : await rpc('record_match', { ...common, p_winner: W[0], p_loser: L[0] });
        state.fresh.add(r.match_id);
        await loadAll();
        toast(`Rögzítve! ${namesOf(W)} ${signed(r.delta)} 🏓`, 'ok');
        state.matchesKind = kind;
        location.hash = '#/meccsek';
      });
    };
  }

  /* ---------- Profil ---------- */
  function renderProfile(id) {
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
      ${fold('🏆 Achievementek', `${achOf(p.id).size}/${ACH.length}`, achGrid(p.id))}

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

  /* ---------- Különdíjak és achievementek a felületen ---------- */
  const awardIcons = (pid, kind) => (state.honors?.awardsOf.get(pid) || [])
    .filter((key) => { const a = awardOf(key); return !kind || !a.kind || a.kind === kind; })
    .map((key) => `<span class="aw" data-aw="${key}" role="button" title="${esc(awardOf(key).name)}">${awardOf(key).icon}</span>`).join('');

  function openAward(key) {
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

  function openAch(id, pid) {
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
  const fold = (title, count, inner, open = false) => `
    <details class="fold" ${open ? 'open' : ''}>
      <summary><span class="fold-arrow">▸</span><span class="fold-title">${title}</span>${count != null ? `<span class="fold-count">${count}</span>` : ''}</summary>
      <div class="fold-body">${inner}</div>
    </details>`;

  function achGrid(pid) {
    const mine = achOf(pid);
    return `<div class="ach-grid">${ACH.map((a) => `
      <button type="button" class="ach ${mine.has(a.id) ? '' : 'off'}" data-ach="${a.id}" data-pid="${pid}">
        <span class="ach-ic">${a.icon}</span><span class="ach-nm">${esc(a.name)}</span>
      </button>`).join('')}</div>`;
  }

  // Különdíj-váltás sáv a meccslistában
  function bandHTML(e) {
    const a = awardOf(e.key);
    return `
      <div class="band">
        <span class="band-ic">${a.icon}</span>
        <span class="band-tx"><b>${esc(a.name)}</b><span>${e.from.length ? `${esc(namesOf(e.from))} → ` : 'új gazda: '}<strong>${esc(namesOf(e.to))}</strong></span></span>
      </div>`;
  }

  // Gratuláció az új achievementekért (a telefon megjegyzi, miket látott már)
  function checkNewAchievements() {
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

  function confetti() {
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

  /* ---------- Statisztikáim (csak a saját profilon) ---------- */
  const WEEKDAYS = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
  const WD_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
  const DAYPARTS = [['éjjel', 0, 5], ['reggel', 5, 10], ['napközben', 10, 17], ['este', 17, 24]];
  const partOf = (h) => DAYPARTS.find(([, a, b]) => h >= a && h < b)[0];

  function duration(ms) {
    const days = Math.floor(ms / DAY); const hours = Math.floor((ms % DAY) / 3600000);
    if (days) return `${days} nap${hours ? ` ${hours} óra` : ''}`;
    if (hours) return `${hours} óra`;
    return `${Math.max(1, Math.round(ms / 60000))} perc`;
  }

  function renderMyStats() {
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

  function drawChart(canvas, history, color, rgbaPrefix) {
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
          toast(`🏓 ${namesOf(m.winners)} nyert ${namesOf(m.losers)} ellen${m.scoreW != null ? ' (' + scoreHTML(m) + ')' : ''}`);
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
    if (store.get(KIND_KEY) === 'doubles') state.matchesKind = 'doubles';

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

    // különdíj- és achievement-ikonok: koppintásra magyarázat (a sor linkje helyett)
    $app.addEventListener('click', (e) => {
      const aw = e.target.closest('[data-aw]');
      const ac = e.target.closest('[data-ach]');
      if (!aw && !ac) return;
      e.preventDefault(); e.stopPropagation();
      if (aw) openAward(aw.dataset.aw); else openAch(ac.dataset.ach, ac.dataset.pid);
    }, true);

    subscribe();
    window.addEventListener('hashchange', () => { state.profileKind = 'singles'; route(); window.scrollTo(0, 0); });
    // ha a telefon visszatér az apphoz, frissítünk (háttérben lemaradhatott valami)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
    route();
  }

  init();
})();
