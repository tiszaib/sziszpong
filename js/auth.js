// SZISZpong · Belépés, regisztráció, kijelentkezés
import { $app, ME_KEY, TOKEN_KEY, activePlayers, busy, byName, enhanceSelect, esc, rpc, state, store, toast } from './core.js';
import { loadAll } from './data.js';
import { route } from './router.js';

/* ---------- Belépés / regisztráció ---------- */
export function renderAuth(mode) {
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

export async function afterLogin(token) {
  state.token = token;
  store.set(TOKEN_KEY, token);
  state.me = await rpc('me', { p_token: token });
  store.set(ME_KEY, JSON.stringify(state.me));
  location.hash = '#/';
  route();
}

export function localLogout() {
  state.token = null; state.me = null;
  store.del(TOKEN_KEY); store.del(ME_KEY);
  location.hash = '#/';
  route();
}
