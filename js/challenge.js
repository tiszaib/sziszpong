// SZISZpong · Kihívások: 1,5x pontos egyéni meccsek
// A szabályokat az adatbázis dönti el (003_kihivas.sql), itt csak megjelenítjük és előre jelezzük őket.
import { $app, busy, eloDelta, esc, modal, nameOf, playerById, ratingOf, rpc, state, toast } from './core.js';
import { loadAll } from './data.js';

export const CH_MULT = 1.5;
const HOUR = 3600000;

// A tényleges állapot: ha a határidő elmúlt, lejárt (akkor is, ha a táblában még nem íródott át)
export function chStatus(c, now = Date.now()) {
  if (c.status === 'pending' && Date.parse(c.answer_by) <= now) return 'expired';
  if (c.status === 'accepted' && Date.parse(c.play_by) <= now) return 'expired';
  return c.status;
}
const isOpen = (c) => ['pending', 'accepted'].includes(chStatus(c));
const involves = (c, id) => c.challenger === id || c.challenged === id;
const pairOf = (c, a, b) => (c.challenger === a && c.challenged === b) || (c.challenger === b && c.challenged === a);
const other = (c, id) => (c.challenger === id ? c.challenged : c.challenger);

export const openChallengeOf = (pid) => (state.challenges || []).find((c) => involves(c, pid) && isOpen(c));
export const liveChallenge = (a, b) => (state.challenges || []).find((c) => pairOf(c, a, b) && chStatus(c) === 'accepted');
export const inLiveChallenge = (pid) => (state.challenges || []).some((c) => involves(c, pid) && chStatus(c) === 'accepted');

// Hátralévő idő, pl. "5 ó 42 p"
export function timeLeft(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const h = Math.floor(ms / HOUR); const m = Math.floor((ms % HOUR) / 60000);
  return h ? `${h} ó ${m} p` : `${m} p`;
}
const timer = (iso, tail) => `<span class="ch-timer" data-until="${esc(iso)}" data-tail="${esc(tail)}"><i></i>${timeLeft(iso)}${tail}</span>`;

// Mennyit ér a kihívás nekem a másik ellen (nyerés / vereség)
export function stake(me, opp) {
  const a = ratingOf(playerById(me), 'singles'); const b = ratingOf(playerById(opp), 'singles');
  return { win: eloDelta(a, b, CH_MULT), lose: eloDelta(b, a, CH_MULT) };
}
const stakeHTML = (s) => `<div class="ch-stake"><span class="up">ha nyersz<b>+${s.win}</b></span><span class="down">ha kikapsz<b>−${s.lose}</b></span></div>`;

// Kihívhatom-e most? (az adatbázis ugyanezt ellenőrzi, ez csak az előzetes jelzés)
export function canChallenge(targetId) {
  const me = state.me?.id; const t = playerById(targetId);
  if (!state.chEnabled || !me || !t || targetId === me) return { ok: false, reason: '' };
  if (!t.active) return { ok: false, reason: 'Nem aktív játékos.' };
  const live = liveChallenge(me, targetId);
  if (live) return { ok: false, live };
  if (openChallengeOf(me)) return { ok: false, reason: 'Már van nyitott kihívásod.' };
  if (openChallengeOf(targetId)) return { ok: false, reason: `${t.name} már benne van egy kihívásban.` };
  const now = Date.now();
  const no = state.challenges.find((c) => c.challenger === me && c.challenged === targetId && c.status === 'declined'
    && Date.parse(c.responded_at) > now - 72 * HOUR);
  if (no) return { ok: false, reason: 'Nemrég nemet mondott, 3 napig nem hívhatod ki újra.' };
  const played = state.challenges.find((c) => pairOf(c, me, targetId) && c.status === 'played'
    && state.matches.some((m) => m.id === c.match_id && Date.parse(m.at) > now - 24 * HOUR));
  if (played) return { ok: false, reason: '24 órán belül csak egy kihívást játszhattok egymással.' };
  return { ok: true };
}

// Gomb a profilon
export function challengeButtonHTML(targetId) {
  const r = canChallenge(targetId);
  if (r.live) return '<button type="button" class="btn block ch-go ch-btn" data-ch-rec>⚔️ Élő kihívás: eredmény rögzítése</button>';
  if (r.ok) return '<button type="button" class="btn block ch-go ch-btn" data-ch-new>⚔️ Kihívom</button>';
  if (r.reason) return `<button type="button" class="btn block ch-btn ch-off" disabled>⚔️ Kihívom<small>${esc(r.reason)}</small></button>`;
  return '';
}

export function openChallengeModal(targetId) {
  const t = playerById(targetId);
  modal({
    title: `⚔️ Kihívod: ${t.name}?`,
    text: `${t.name} 6 órán belül fogadhatja el, utána 24 órátok van lejátszani. A meccs 1,5x pontot ér.`,
    body: `${stakeHTML(stake(state.me.id, targetId))}
      <label class="field"><span>Üzenet (nem kötelező)</span>
        <input class="input" name="msg" maxlength="140" placeholder="pl. ma 8-kor a teremben? 😏" autocomplete="off"></label>`,
    okText: 'Kihívás küldése',
    onOk: async (form) => {
      await rpc('challenge_create', { p_token: state.token, p_target: targetId, p_message: form.elements.msg.value || null });
      await loadAll();
      toast(`Kihívás elküldve ⚔️ ${t.name} az appban látja.`, 'ok');
      setTimeout(refresh, 0);   // az ablak bezárása után rajzolunk újra
    },
  });
  const ok = document.querySelector('#modal-form [type=submit]');
  if (ok) ok.classList.add('ch-go');
}

// Kártya a ranglista tetején (csak ha nekem van nyitott kihívásom)
export function challengeCardHTML() {
  const me = state.me?.id;
  const c = me && state.chEnabled ? openChallengeOf(me) : null;
  if (!c) return '';
  const st = chStatus(c); const opp = other(c, me);
  if (st === 'pending' && c.challenged === me) {
    return `
      <div class="ch-card" data-ch="${c.id}">
        <div class="ch-label">⚔️ KIHÍVÁS ${timer(c.answer_by, ' van válaszolni')}</div>
        <div class="ch-title">${esc(nameOf(opp))} kihívott!</div>
        ${c.message ? `<div class="ch-msg">„${esc(c.message)}”</div>` : ''}
        ${stakeHTML(stake(me, opp))}
        <div class="ch-btns"><button type="button" class="btn ch-go" data-ch-yes>Elfogadom ⚔️</button><button type="button" class="btn" data-ch-no>Nem most</button></div>
      </div>`;
  }
  if (st === 'pending') {
    return `
      <div class="ch-pending" data-ch="${c.id}">
        <span class="ch-p-tx">⚔️ Kihívtad: ${esc(nameOf(opp))}<span>Válaszra vár · ${timer(c.answer_by, '')}</span></span>
        <button type="button" class="btn ch-cancel" data-ch-cancel>Visszavonom</button>
      </div>`;
  }
  const total = 24 * HOUR; const left = Math.max(0, Date.parse(c.play_by) - Date.now());
  const cr = c.challenger; const cd = c.challenged;
  const who = (id) => `<div><b>${esc(nameOf(id))}</b><small>${id === cr ? 'kihívó' : 'kihívott'}${id === me ? ' · te' : ''} · ${ratingOf(playerById(id), 'singles')}</small></div>`;
  return `
    <div class="ch-card" data-ch="${c.id}">
      <div class="ch-label">⚔️ ÉLŐ KIHÍVÁS · 1,5x ${timer(c.play_by, '')}</div>
      <div class="ch-vs">${who(cr)}<span class="x">⚔️</span>${who(cd)}</div>
      <div class="ch-bar"><i style="width:${Math.round((left / total) * 100)}%"></i></div>
      <button type="button" class="btn block ch-go" data-ch-rec>🏓 Eredmény rögzítése</button>
    </div>`;
}

// Élő kihívás rögzítése: az Új meccs oldal kitöltve, bekapcsolt kihívás-kapcsolóval
export function startChallengeMatch(c) {
  const me = state.me.id;
  const first = involves(c, me) ? me : c.challenger;
  state.prefill = { kind: 'singles', sides: [[first], [other(c, first)]], challenge: c.id };
  state.newKind = 'singles';
  location.hash = '#/uj';
}

let refresh = () => {};
export function setChallengeRefresh(fn) { refresh = fn; }

export function bindChallenges(root = $app, targetId = null) {
  const card = root.querySelector('[data-ch]');
  const c = card && state.challenges.find((x) => x.id === card.dataset.ch);
  const respond = (btn, yes) => busy(btn, async () => {
    await rpc('challenge_respond', { p_token: state.token, p_challenge: c.id, p_accept: yes });
    await loadAll();
    toast(yes ? 'Elfogadva! 24 órátok van lejátszani. ⚔️' : 'Rendben, most nem.', yes ? 'ok' : undefined);
    refresh();
  });
  root.querySelector('[data-ch-yes]')?.addEventListener('click', (e) => respond(e.currentTarget, true));
  root.querySelector('[data-ch-no]')?.addEventListener('click', (e) => respond(e.currentTarget, false));
  root.querySelector('[data-ch-cancel]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await rpc('challenge_cancel', { p_token: state.token, p_challenge: c.id });
    await loadAll();
    toast('Kihívás visszavonva.');
    refresh();
  }));
  root.querySelectorAll('[data-ch-rec]').forEach((b) => {
    b.onclick = () => {
      const live = c && chStatus(c) === 'accepted' ? c : liveChallenge(state.me.id, targetId);
      if (live) startChallengeMatch(live);
    };
  });
  root.querySelector('[data-ch-new]')?.addEventListener('click', () => openChallengeModal(targetId));
}

// Események a Meccsek listába (csak egyéni): elfogadva, nem vállalta, lejárt
export function challengeEvents() {
  const now = Date.now(); const out = [];
  for (const c of state.challenges || []) {
    const st = chStatus(c, now);
    if (c.responded_at && ['accepted', 'played'].includes(c.status)) out.push({ at: c.responded_at, type: 'accepted', c });
    if (c.status === 'declined') out.push({ at: c.responded_at, type: 'declined', c });
    if (st === 'expired') out.push({ at: c.responded_at ? c.play_by : c.answer_by, type: 'expired', c });
  }
  return out.filter((e) => Date.parse(e.at) <= now);
}

export function challengeBandHTML(e) {
  const a = esc(nameOf(e.c.challenger)); const b = esc(nameOf(e.c.challenged));
  if (e.type === 'accepted') return `<div class="band chb"><span class="band-ic">⚔️</span><span class="band-tx"><b>Kihívás elfogadva</b><span>${a} ⚔️ <strong>${b}</strong></span></span></div>`;
  if (e.type === 'declined') return `<div class="band chick"><span class="band-ic">🐔</span><span class="band-tx"><b>Nem vállalta</b><span>${a} kihívását: <strong>${b}</strong></span></span></div>`;
  return `<div class="band chx"><span class="band-ic">⌛</span><span class="band-tx"><b>Lejárt kihívás</b><span>${a} ⚔️ ${b}</span></span></div>`;
}

// A visszaszámlálók frissítése teljes újrarajzolás nélkül (percenként)
export function tickTimers() {
  let expired = false;
  document.querySelectorAll('.ch-timer[data-until]').forEach((el) => {
    if (Date.parse(el.dataset.until) <= Date.now()) expired = true;
    el.innerHTML = `<i></i>${timeLeft(el.dataset.until)}${el.dataset.tail || ''}`;
  });
  return expired;
}
