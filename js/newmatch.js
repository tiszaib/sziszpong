// SZISZpong · Új meccs rögzítése
import { $app, activePlayers, busy, byName, eloDelta, enhanceSelect, esc, kindSwitch, nameOf, namesOf, playerById, ratingOf, rpc, signed, state, toast } from './core.js';
import { loadAll } from './data.js';

/* ---------- Új meccs ---------- */
export function renderNewMatch() {
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
