// SZISZpong · Alapok: beállítások, közös állapot, segédfüggvények, felugró ablakok, névválasztó
import { localLogout } from './auth.js';
import { gamesOf } from './data.js';

export const CFG = window.SZISZ_CONFIG || {};
export const K = 32;                         // ELO K-szám (ugyanaz, mint az adatbázisban)
export const TOKEN_KEY = 'sziszpong.token';
export const KIND_KEY = 'sziszpong.kind';
export const ME_KEY = 'sziszpong.me';      // a belépett játékos adatai, hogy net nélkül is azonnal induljon

export const $app = document.getElementById('app');
export const $nav = document.getElementById('nav');
export const $toast = document.getElementById('toast');
export const $modal = document.getElementById('modal');
export const $live = document.getElementById('live');

export let sb = null;          // Supabase kliens (indításkor kap értéket)
export function setSb(c) { sb = c; }
export let charts = [];        // a profil grafikonjai
export const state = {
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
  challenges: [],       // az elmúlt 14 nap kihívásai
  chEnabled: true,      // false, ha az adatbázisban még nincs kihívás (003_kihivas.sql nem futott le)
  prefill: null,        // Új meccs előre kitöltve (visszavágó, kihívás)
};

/* ------------------------------------------------------------------
   1. Segédfüggvények
   ------------------------------------------------------------------ */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privát mód */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* privát mód */ } },
};

// mult = szorzó: sima meccs 1, kihívás 1,5 (ugyanaz a képlet, mint az adatbázis _elo_delta függvénye)
export function eloDelta(winnerElo, loserElo, mult = 1) {
  return Math.max(1, Math.round(K * mult * (1 - 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400)))));
}

export const playerById = (id) => state.players.find((p) => p.id === id);
export const nameOf = (id) => playerById(id)?.name ?? 'Ismeretlen';
export const namesOf = (ids) => ids.map(nameOf).join(' & ');
export const byName = (a, b) => a.name.localeCompare(b.name, 'hu');
export const activePlayers = () => state.players.filter((p) => p.active);
export const ratingOf = (p, kind) => (kind === 'doubles' ? p.elo_doubles : p.elo);
export const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');
export const kindLabel = (kind) => (kind === 'doubles' ? 'Páros' : 'Egyéni');

export function ranked(kind) {
  let list = activePlayers();
  // a listán csak az szerepel, aki már játszott ilyen meccset
  list = list.filter((p) => gamesOf(p.id, kind) > 0);
  return list.sort((a, b) => ratingOf(b, kind) - ratingOf(a, kind) || byName(a, b));
}

export function localISODate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const clock = (iso) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso) => new Date(iso).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso) {
  const d = new Date(iso);
  const key = localISODate(d);
  if (key === localISODate()) return 'Ma';
  if (key === localISODate(new Date(Date.now() - 86400000))) return 'Tegnap';
  return d.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
}

export let toastTimer = null;
export function toast(msg, kind = '') {
  $toast.textContent = msg;
  $toast.className = 'toast ' + kind;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, kind === 'error' ? 4200 : 2800);
}

// Supabase függvényhívás egységes hibakezeléssel
export async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (/Lejárt a belépésed/.test(error.message)) { localLogout(); }
    throw new Error(error.message || 'Hiba történt, próbáld újra.');
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// Gomb "dolgozik" állapotba, amíg fut a művelet
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>'; }
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}

export function closeModal() { $modal.hidden = true; $modal.innerHTML = ''; document.querySelectorAll('.confetti').forEach((c) => c.remove()); }

// Felugró ablak. onOk nélkül csak egy "Bezárás" gomb van rajta.
export function modal({ title, text = '', body = '', okText = 'Mentés', danger = false, onOk }) {
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
export const fold2 = (t) => t.toLocaleLowerCase('hu').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function enhanceSelect(sel) {
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

export function openPicker(sel) {
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
export const kindSwitch = (current, id) => `
  <div class="tabs" id="${id}">
    <button type="button" class="tab ${current === 'singles' ? 'active' : ''}" data-kind="singles">Egyéni</button>
    <button type="button" class="tab ${current === 'doubles' ? 'active' : ''}" data-kind="doubles">Páros</button>
  </div>`;
