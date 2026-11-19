-- =====================================================================
--  SZISZpong adatbázis
--  Másold be az egészet a Supabase "SQL Editor"-ába, és nyomd meg a Run gombot.
--  Csak egyszer kell lefuttatni.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  Táblák
-- ---------------------------------------------------------------------

-- Játékosok (ezt mindenki láthatja)
create table public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  elo         integer not null default 1000,
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index players_name_unique on public.players (lower(name));

-- Titkos adatok: PIN (titkosítva) és a hibás próbálkozások (ezt senki nem láthatja)
create table public.player_secrets (
  player_id        uuid primary key references public.players(id) on delete cascade,
  pin_hash         text not null,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz
);

-- Bejelentkezések ("belépőkártyák"), amiket a telefon megjegyez
create table public.sessions (
  token         uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

-- Meccsek. A "kind" és a "side" miatt később páros is jöhet átépítés nélkül.
create table public.matches (
  id           uuid primary key default gen_random_uuid(),
  played_at    timestamptz not null default now(),
  kind         text not null default 'singles' check (kind in ('singles', 'doubles')),
  winner_side  smallint not null check (winner_side in (1, 2)),
  score        text check (score is null or char_length(score) <= 40),
  recorded_by  uuid references public.players(id) on delete set null
);
create index matches_played_at_idx on public.matches (played_at desc);

-- Ki melyik oldalon játszott, és mennyi volt az ELO-ja előtte/utána
create table public.match_players (
  match_id    uuid not null references public.matches(id) on delete cascade,
  player_id   uuid not null references public.players(id),
  side        smallint not null check (side in (1, 2)),
  elo_before  integer not null,
  elo_after   integer not null,
  primary key (match_id, player_id)
);
create index match_players_player_idx on public.match_players (player_id);

-- Hír és quote doboz (egyetlen sor)
create table public.news (
  id          integer primary key default 1 check (id = 1),
  text        text,
  expires_on  date,
  updated_at  timestamptz not null default now()
);
insert into public.news (id) values (1);

-- Beállítások: a kolis regisztrációs kód (titkosítva, senki nem láthatja)
create table public.app_settings (
  id             integer primary key default 1 check (id = 1),
  reg_code_hash  text not null
);
insert into public.app_settings (id, reg_code_hash)
values (1, extensions.crypt('IDE_JON_A_KOLIS_KOD', extensions.gen_salt('bf')));

-- ---------------------------------------------------------------------
--  Jogosultságok: olvasni bárki tud (kivéve a titkos táblákat),
--  írni csak az alábbi függvényeken keresztül lehet.
-- ---------------------------------------------------------------------
alter table public.players        enable row level security;
alter table public.player_secrets enable row level security;
alter table public.sessions       enable row level security;
alter table public.matches        enable row level security;
alter table public.match_players  enable row level security;
alter table public.news           enable row level security;
alter table public.app_settings   enable row level security;

create policy "mindenki olvashatja" on public.players       for select using (true);
create policy "mindenki olvashatja" on public.matches       for select using (true);
create policy "mindenki olvashatja" on public.match_players for select using (true);
create policy "mindenki olvashatja" on public.news          for select using (true);

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.players, public.matches, public.match_players, public.news to anon, authenticated;

-- ---------------------------------------------------------------------
--  Belső segédfüggvények
-- ---------------------------------------------------------------------

-- ELO: ennyi pontot kap a győztes (és ennyit veszít a vesztes). K = 32.
create or replace function public._elo_delta(winner_elo integer, loser_elo integer)
returns integer language sql immutable as $$
  select greatest(1, round(32 * (1 - 1 / (1 + power(10, (loser_elo - winner_elo) / 400.0)))))::integer;
$$;

-- Ki van belépve ezzel a tokennel? (hibát dob, ha senki)
create or replace function public._session_player(p_token uuid)
returns public.players
language plpgsql security definer set search_path = public, extensions as $$
declare
  v public.players;
begin
  select p.* into v
  from public.sessions s join public.players p on p.id = s.player_id
  where s.token = p_token and p.active;
  if not found then
    raise exception 'Lejárt a belépésed, lépj be újra.';
  end if;
  update public.sessions set last_used_at = now() where token = p_token;
  return v;
end $$;

create or replace function public._require_admin(p_token uuid)
returns public.players
language plpgsql security definer set search_path = public, extensions as $$
declare
  v public.players := public._session_player(p_token);
begin
  if not v.is_admin then
    raise exception 'Ehhez admin jog kell.';
  end if;
  return v;
end $$;

-- PIN ellenőrzése. 5 hibás próbálkozás után 5 percre letilt.
-- NULL-t ad vissza, ha jó a PIN, különben a hibaüzenetet.
create or replace function public._check_pin(p_player uuid, p_pin text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.player_secrets;
begin
  select * into s from public.player_secrets where player_id = p_player for update;
  if not found then
    return 'Ismeretlen játékos.';
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return format('Túl sok hibás PIN. Próbáld újra %s perc múlva.',
                  ceil(extract(epoch from (s.locked_until - now())) / 60)::int);
  end if;
  if p_pin is not null and s.pin_hash = crypt(p_pin, s.pin_hash) then
    update public.player_secrets set failed_attempts = 0, locked_until = null where player_id = p_player;
    return null;
  end if;
  update public.player_secrets
     set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
         locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
   where player_id = p_player;
  return 'Hibás PIN.';
end $$;

create or replace function public._clean_name(p_name text)
returns text language plpgsql immutable as $$
declare
  n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(n) < 2 or char_length(n) > 20 then
    raise exception 'A név 2-20 karakter legyen.';
  end if;
  return n;
end $$;

create or replace function public._clean_score(p_score text)
returns text language sql immutable as $$
  select nullif(left(trim(coalesce(p_score, '')), 40), '');
$$;

-- Minden ELO újraszámolása az elejétől (meccs törlése/javítása után)
create or replace function public._recompute_all()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  w_elo integer;
  l_elo integer;
  d integer;
begin
  update public.players set elo = 1000 where true;
  for m in select id, winner_side from public.matches where kind = 'singles' order by played_at, id loop
    select p.elo into w_elo from public.match_players mp join public.players p on p.id = mp.player_id
     where mp.match_id = m.id and mp.side = m.winner_side;
    select p.elo into l_elo from public.match_players mp join public.players p on p.id = mp.player_id
     where mp.match_id = m.id and mp.side <> m.winner_side;
    d := public._elo_delta(w_elo, l_elo);
    update public.match_players mp
       set elo_before = p.elo,
           elo_after  = p.elo + case when mp.side = m.winner_side then d else -d end
      from public.players p
     where p.id = mp.player_id and mp.match_id = m.id;
    update public.players p
       set elo = mp.elo_after
      from public.match_players mp
     where mp.player_id = p.id and mp.match_id = m.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Függvények, amiket a weboldal hív
-- ---------------------------------------------------------------------

-- Regisztráció: név + PIN + kolis kód. Az első regisztráló lesz az admin.
create or replace function public.register(p_name text, p_pin text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := public._clean_name(p_name);
  v_hash text;
  v_id uuid;
  v_admin boolean;
  v_token uuid;
begin
  select reg_code_hash into v_hash from public.app_settings where id = 1;
  if v_hash <> crypt(upper(trim(coalesce(p_code, ''))), v_hash) then
    return jsonb_build_object('error', 'Hibás kolis kód.');
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    return jsonb_build_object('error', 'A PIN pontosan 4 számjegy legyen.');
  end if;
  if exists (select 1 from public.players where lower(name) = lower(n)) then
    return jsonb_build_object('error', 'Ez a név már foglalt.');
  end if;
  v_admin := not exists (select 1 from public.players);
  insert into public.players (name, is_admin) values (n, v_admin) returning id into v_id;
  insert into public.player_secrets (player_id, pin_hash) values (v_id, crypt(p_pin, gen_salt('bf')));
  insert into public.sessions (player_id) values (v_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'player_id', v_id);
end $$;

-- Belépés: játékos kiválasztása + PIN
create or replace function public.login(p_player_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  err text;
  v_token uuid;
begin
  if not exists (select 1 from public.players where id = p_player_id and active) then
    return jsonb_build_object('error', 'Ismeretlen játékos.');
  end if;
  err := public._check_pin(p_player_id, p_pin);
  if err is not null then
    return jsonb_build_object('error', err);
  end if;
  insert into public.sessions (player_id) values (p_player_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'player_id', p_player_id);
end $$;

-- Ki vagyok? (NULL, ha a belépés már nem érvényes)
create or replace function public.me(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v public.players;
begin
  select p.* into v
  from public.sessions s join public.players p on p.id = s.player_id
  where s.token = p_token and p.active;
  if not found then
    return null;
  end if;
  update public.sessions set last_used_at = now() where token = p_token;
  return jsonb_build_object('id', v.id, 'name', v.name, 'is_admin', v.is_admin);
end $$;

create or replace function public.logout(p_token uuid)
returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.sessions where token = p_token;
$$;

-- Meccs rögzítése. Ha a rögzítő nem játszott a meccsen,
-- akkor az egyik játékos PIN-je kell (p_pin_player + p_pin).
create or replace function public.record_match(
  p_token uuid, p_winner uuid, p_loser uuid,
  p_score text default null, p_pin_player uuid default null, p_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  recorder public.players := public._session_player(p_token);
  w public.players;
  l public.players;
  err text;
  d integer;
  v_match uuid;
begin
  if p_winner is null or p_loser is null or p_winner = p_loser then
    return jsonb_build_object('error', 'Válassz két különböző játékost.');
  end if;
  -- sorrendben zárolunk, hogy két egyszerre beküldött meccs ne akadjon össze
  perform 1 from public.players where id in (p_winner, p_loser) order by id for update;
  select * into w from public.players where id = p_winner and active;
  select * into l from public.players where id = p_loser and active;
  if w.id is null or l.id is null then
    return jsonb_build_object('error', 'Ismeretlen játékos.');
  end if;

  if recorder.id not in (w.id, l.id) then
    if p_pin_player is null or p_pin_player not in (w.id, l.id) then
      return jsonb_build_object('error', 'Az egyik játékos PIN-je kell.');
    end if;
    err := public._check_pin(p_pin_player, p_pin);
    if err is not null then
      return jsonb_build_object('error', err);
    end if;
  end if;

  -- dupla koppintás elleni védelem
  if exists (
    select 1 from public.matches m
    where m.recorded_by = recorder.id and m.played_at > now() - interval '15 seconds'
      and (select count(*) from public.match_players mp
           where mp.match_id = m.id and mp.player_id in (w.id, l.id)) = 2
  ) then
    return jsonb_build_object('error', 'Ezt a meccset épp most rögzítetted.');
  end if;

  d := public._elo_delta(w.elo, l.elo);
  insert into public.matches (winner_side, score, recorded_by)
  values (1, public._clean_score(p_score), recorder.id)
  returning id into v_match;
  insert into public.match_players (match_id, player_id, side, elo_before, elo_after) values
    (v_match, w.id, 1, w.elo, w.elo + d),
    (v_match, l.id, 2, l.elo, l.elo - d);
  update public.players set elo = elo + d where id = w.id;
  update public.players set elo = elo - d where id = l.id;
  return jsonb_build_object('match_id', v_match, 'delta', d);
end $$;

-- ----- Admin -----

create or replace function public.admin_delete_match(p_token uuid, p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_admin(p_token);
  delete from public.matches where id = p_match_id;
  perform public._recompute_all();
  return jsonb_build_object('ok', true);
end $$;

-- Meccs javítása: ki nyert és mi lett az eredmény
create or replace function public.admin_update_match(p_token uuid, p_match_id uuid, p_winner uuid, p_score text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s smallint;
begin
  perform public._require_admin(p_token);
  select side into s from public.match_players where match_id = p_match_id and player_id = p_winner;
  if s is null then
    return jsonb_build_object('error', 'Ez a játékos nem játszott ezen a meccsen.');
  end if;
  update public.matches set winner_side = s, score = public._clean_score(p_score) where id = p_match_id;
  perform public._recompute_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_rename_player(p_token uuid, p_player_id uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := public._clean_name(p_name);
begin
  perform public._require_admin(p_token);
  if exists (select 1 from public.players where lower(name) = lower(n) and id <> p_player_id) then
    return jsonb_build_object('error', 'Ez a név már foglalt.');
  end if;
  update public.players set name = n where id = p_player_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_pin(p_token uuid, p_player_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_admin(p_token);
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    return jsonb_build_object('error', 'A PIN pontosan 4 számjegy legyen.');
  end if;
  update public.player_secrets
     set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null
   where player_id = p_player_id;
  return jsonb_build_object('ok', true);
end $$;

-- Játékos eltávolítása. Ha már játszott meccset, csak elrejtjük
-- (a meccselőzmények megmaradnak), különben teljesen töröljük.
create or replace function public.admin_remove_player(p_token uuid, p_player_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.players := public._require_admin(p_token);
begin
  if a.id = p_player_id then
    return jsonb_build_object('error', 'Saját magadat nem távolíthatod el.');
  end if;
  if exists (select 1 from public.match_players where player_id = p_player_id) then
    update public.players set active = false where id = p_player_id;
    delete from public.sessions where player_id = p_player_id;
    return jsonb_build_object('ok', true, 'hidden', true);
  end if;
  delete from public.players where id = p_player_id;
  return jsonb_build_object('ok', true, 'deleted', true);
end $$;

create or replace function public.admin_restore_player(p_token uuid, p_player_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_admin(p_token);
  update public.players set active = true where id = p_player_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_reg_code(p_token uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c text := upper(trim(coalesce(p_code, '')));
begin
  perform public._require_admin(p_token);
  if char_length(c) < 3 then
    return jsonb_build_object('error', 'A kód legalább 3 karakter legyen.');
  end if;
  update public.app_settings set reg_code_hash = crypt(c, gen_salt('bf')) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_news(p_token uuid, p_text text, p_expires_on date)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_admin(p_token);
  update public.news
     set text = nullif(left(trim(coalesce(p_text, '')), 500), ''),
         expires_on = p_expires_on,
         updated_at = now()
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  Ki mit hívhat: a belső (_ kezdetű) függvényeket senki kívülről
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.register(text, text, text),
  public.login(uuid, text),
  public.me(uuid),
  public.logout(uuid),
  public.record_match(uuid, uuid, uuid, text, uuid, text),
  public.admin_delete_match(uuid, uuid),
  public.admin_update_match(uuid, uuid, uuid, text),
  public.admin_rename_player(uuid, uuid, text),
  public.admin_reset_pin(uuid, uuid, text),
  public.admin_remove_player(uuid, uuid),
  public.admin_restore_player(uuid, uuid),
  public.admin_set_reg_code(uuid, text),
  public.admin_set_news(uuid, text, date)
to anon, authenticated;

-- ---------------------------------------------------------------------
--  Élő frissítés: ezekről a táblákról azonnal szól az oldalnak
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.matches, public.players, public.news;

-- Kész! 🏓
