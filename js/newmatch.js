// SZISZpong · Új meccs rögzítése
import { $app, activePlayers, busy, byName, eloDelta, enhanceSelect, esc, kindSwitch, nameOf, namesOf, playerById, ratingOf, rpc, signed, state, toast } from './core.js';
import { loadAll } from './data.js';
import { CH_MULT, liveChallenge } from './challenge.js';
import { liveTourGame, loadTour } from './tournament.js';

/* ---------- Visszavágó ---------- */
const REMATCH_WINDOW = 3 * 3600 * 1000;   // csak az elmúlt 3 óra meccseit ajánljuk fel
const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - new Date(t)) / 60000)); return m < 60 ? `${m} perce` : `${Math.round(m / 60)} órája`; };

// A meccs csapatai úgy, hogy (ha benne vagy) te az 1. oldalon legyél
export function rematchSides(m) {
  const me = state.me?.id;
  const mineFirst = m.losers.includes(me) ? [m.losers, m.winners] : [m.winners, m.losers];
  return mineFirst.map((side) => { const s = [...side]; const i = s.indexOf(me); if (i > 0) { s.splice(i, 1); s.unshift(me); } return s; });
}
export function startRematch(m) {
  state.prefill = { kind: m.kind, sides: rematchSides(m) };
  state.newKind = m.kind;
}
function lastMine() {
  const me = state.me?.id;
  const m = state.matches.find((x) => x.winners.includes(me) || x.losers.includes(me));
  return m && Date.now() - new Date(m.at) < REMATCH_WINDOW ? m : null;
}
function rematchBubble(m) {
  const [mine, other] = rematchSides(m);
  const won = m.winners.includes(state.me.id);
  const partner = mine.slice(1);
  const who = partner.length ? `te & ${esc(namesOf(partner))} vs ${esc(namesOf(other))}` : `${esc(namesOf(other))} ellen`;
  const sc = m.scoreW != null ? (won ? `${m.scoreW}:${m.scoreL}` : `${m.scoreL}:${m.scoreW}`) : '';
  return `
    <span class="rm-wrap">
      <button type="button" class="rm-btn" id="rm" aria-label="Visszavágó" aria-expanded="false">🔁</button>
      <button type="button" class="rm-bubble" id="rm-ok" hidden>
        <b>Visszavágó?</b>
        <span class="rm-who">${who}</span>
        <em class="${won ? 'w' : 'l'}">${won ? 'nyertél' : 'kikaptál'} ${sc}</em><em> · ${ago(m.at)}</em>
        <span class="rm-cta">Koppints a kitöltéshez ›</span>
      </button>
    </span>`;
}

/* ---------- Új meccs ---------- */
export function renderNewMatch() {
  const kind = state.newKind;
  const dbl = kind === 'doubles';
  const list = activePlayers().sort(byName);
  // f.sides[0] = 1. oldal, f.sides[1] = 2. oldal; egyéniben 1-1, párosban 2-2 hely
  const f = { sides: dbl ? [[state.me.id, ''], ['', '']] : [[state.me.id], ['']], winner: 0, pinPlayer: '', ch: null, chOff: new Set(), tg: null, tgOff: false };
  const pre = state.prefill?.kind === kind ? state.prefill : null;
  state.prefill = null;
  if (pre) f.sides = pre.sides.map((x) => [...x]);
  const last = pre ? null : lastMine();
  const chosen = () => f.sides.flat().filter(Boolean);

  const slot = (s, i) => `
    <select class="select" data-side="${s}" data-slot="${i}" aria-label="${s + 1}. oldal, ${i + 1}. játékos"></select>`;

  $app.innerHTML = `
    <div class="title-row"><h1 class="page-title">Új meccs</h1>${last ? rematchBubble(last) : ''}</div>
    <div id="chbox"></div>
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

    // kupameccs: ha a két játékosnak esedékes Lánchíd Kupa meccse van, a kapcsoló alapból be van kapcsolva
    const tour = !dbl && full ? liveTourGame(f.sides[0][0], f.sides[1][0]) : null;
    f.tg = tour && !f.tgOff ? tour : null;
    // kihívás: ha a két játékos között élő kihívás van, a kapcsoló alapból be van kapcsolva (kupameccs mellett nem)
    const live = !dbl && full && !f.tg ? liveChallenge(f.sides[0][0], f.sides[1][0]) : null;
    f.ch = live && !f.chOff.has(live.id) ? live : null;
    const box = $app.querySelector('#chbox');
    const stage = (t) => (t.game.r === -1 ? 'bronzmeccs' : ['a döntő · 2x pont', 'elődöntő', 'negyeddöntő', 'nyolcaddöntő'][Math.log2(t.cup.size) - 1 - t.game.r]);
    box.innerHTML = tour ? `
      <button type="button" class="ch-toggle tour-toggle ${f.tg ? '' : 'off'}" id="tgsw" role="switch" aria-checked="${!!f.tg}">
        <span><b>🏆 Bajnoki meccs</b><small>Lánchíd Kupa · ${f.tg ? stage(tour) : 'kikapcsolva, sima meccs'}</small></span><span class="sw"></span>
      </button>` : live ? `
      <button type="button" class="ch-toggle ${f.ch ? '' : 'off'}" id="chsw" role="switch" aria-checked="${!!f.ch}">
        <span><b>⚔️ Kihívás meccs</b><small>${esc(nameOf(live.challenger))} kihívása · ${f.ch ? '1,5x pont' : 'kikapcsolva, sima meccs'}</small></span><span class="sw"></span>
      </button>` : '';
    if (tour) box.querySelector('#tgsw').onclick = () => { f.tgOff = !f.tgOff; update(); };
    else if (live) box.querySelector('#chsw').onclick = () => { if (f.chOff.has(live.id)) f.chOff.delete(live.id); else f.chOff.add(live.id); update(); };
    form.classList.toggle('chm', !!f.ch);
    form.classList.toggle('tgm', !!f.tg);

    const pv = form.querySelector('#preview');
    if (full && f.winner) {
      const W = f.sides[f.winner - 1]; const L = f.sides[2 - f.winner];
      const avg = (ids) => ids.reduce((t, id) => t + ratingOf(playerById(id), kind), 0) / ids.length;
      const d = eloDelta(Math.round(avg(W)), Math.round(avg(L)), f.ch ? CH_MULT : f.tg?.final ? 2 : 1);
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
  // két számjegy után (pl. 11) a kurzor magától átugrik a másik, még üres mezőre
  const jump = (from, to) => () => { update(); if (from.value.length >= 2 && to.value === '') to.focus(); };
  s1.oninput = jump(s1, s2); s2.oninput = jump(s2, s1);
  update();

  const rm = $app.querySelector('#rm');
  if (rm) {
    const bub = $app.querySelector('#rm-ok');
    const show = (on) => {
      rm.setAttribute('aria-expanded', on); rm.classList.toggle('on', on);
      if (on) { bub.hidden = false; requestAnimationFrame(() => bub.classList.add('open')); }
      else { bub.classList.remove('open'); setTimeout(() => { if (!bub.classList.contains('open')) bub.hidden = true; }, 200); }
    };
    const fill = () => { bub.classList.add('go'); setTimeout(() => { startRematch(last); renderNewMatch(); }, 180); };
    // 1. koppintás: buborék, 2. koppintás (gombra vagy buborékra): kitöltés
    rm.onclick = (e) => { e.stopPropagation(); if (rm.classList.contains('on')) fill(); else show(true); };
    bub.onclick = (e) => { e.stopPropagation(); fill(); };
    const away = (e) => { if (!document.body.contains(rm)) { document.removeEventListener('click', away); return; } if (!e.target.closest('.rm-wrap')) show(false); };
    document.addEventListener('click', away);
  }
  if (pre) {
    // a kitöltött nevek sorban felvillannak, utána jöhet az eredmény
    $app.querySelectorAll('#nm .picker').forEach((b, i) => { b.style.animationDelay = `${i * 70}ms`; b.classList.add('filled'); });
    setTimeout(() => s1.focus({ preventScroll: true }), 450);
  }

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
        : await rpc('record_match', { ...common, p_winner: W[0], p_loser: L[0], ...(f.ch ? { p_challenge: f.ch.id } : {}), ...(f.tg ? { p_tournament: f.tg.cup.id } : {}) });
      state.fresh.add(r.match_id);
      await Promise.all([loadAll(), r.tournament ? loadTour() : null]);
      toast(`Rögzítve! ${namesOf(W)} ${signed(r.delta)} ${r.tournament ? '🏆' : f.ch ? '⚔️' : '🏓'}`, 'ok');
      state.matchesKind = kind;
      // kupameccs után vissza a hídra, ahol a győztes útja felizzik
      if (r.tournament) { state.tourAfter = { ...r.tournament, w: W[0] }; location.hash = '#/bajnoksag'; }
      else location.hash = '#/meccsek';
    });
  };
}
