-- =====================================================================
--  SZISZpong – 4. frissítés: Bajnokság (Lánchíd Kupa)
--  Másold be az egészet a Supabase "SQL Editor"-ába, és nyomd meg a Run gombot.
--  A meglévő játékosok, meccsek és kihívások megmaradnak, semmi nem számolódik újra.
--  FONTOS: előbb ezt futtasd le, és csak utána mergeld az app frissítését.
--  (A mostani app ezzel az SQL-lel is gond nélkül működik tovább.)
-- =====================================================================

-- ---------- Kupák ----------
-- status: reg (jelentkezés) → running (zajlik) → done (kész); mellékág: cancelled (elmaradt)
create table if not exists public.tournaments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'Lánchíd Kupa',
  size         smallint not null check (size in (4, 8, 16)),
  bronze       boolean not null default true,
  message      text check (message is null or char_length(message) <= 140),
  status       text not null default 'reg' check (status in ('reg', 'running', 'done', 'cancelled')),
  created_by   uuid references public.players(id) on delete set null,
  created_at   timestamptz not null default now(),
  reg_until    timestamptz not null,                 -- jelentkezési határidő
  round_hours  smallint not null default 24,         -- ennyi óra után a kiíró/admin továbbléptethet
  started_at   timestamptz,
  finished_at  timestamptz,
  champion     uuid references public.players(id) on delete set null,
  runner_up    uuid references public.players(id) on delete set null
);
-- egyszerre csak egy nyitott (jelentkezős vagy zajló) kupa lehet
create unique index if not exists tournaments_one_open on public.tournaments ((status in ('reg', 'running'))) where status in ('reg', 'running');
create index if not exists tournaments_finished_idx on public.tournaments (finished_at);

-- Nevezők (elo és seed a sorsoláskor íródik be)
create table if not exists public.tournament_entries (
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  player_id      uuid not null references public.players(id) on delete cascade,
  joined_at      timestamptz not null default now(),
  elo            integer,
  seed           smallint,
  primary key (tournament_id, player_id)
);

-- A híd mezői. round: 0 = első forduló, a döntő az utolsó; -1 = bronzmeccs. slot: sorszám a fordulón belül.
-- a/b: a két játékos (null = még nem dőlt el, vagy első körben erőnyerő). walkover: meccs nélkül jutott tovább.
create table if not exists public.tournament_games (
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  round          smallint not null check (round >= -1),
  slot           smallint not null check (slot >= 0),
  a              uuid references public.players(id) on delete set null,
  b              uuid references public.players(id) on delete set null,
  winner         uuid references public.players(id) on delete set null,
  score_a        smallint,
  score_b        smallint,
  match_id       uuid references public.matches(id) on delete set null,
  walkover       boolean not null default false,
  ready_at       timestamptz,                         -- mikor lett meg mindkét játékos
  primary key (tournament_id, round, slot)
);

-- A meccsek tournament_id oszlopa (003-ban készült elő) most kap kapcsolatot a kupához
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'matches_tournament_id_fkey') then
    alter table public.matches add constraint matches_tournament_id_fkey
      foreign key (tournament_id) references public.tournaments(id) on delete set null;
  end if;
end $$;

-- ---------- Olvasási jog: mindenki látja (mint a meccseket) ----------
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_games enable row level security;
drop policy if exists "mindenki olvashatja" on public.tournaments;
drop policy if exists "mindenki olvashatja" on public.tournament_entries;
drop policy if exists "mindenki olvashatja" on public.tournament_games;
create policy "mindenki olvashatja" on public.tournaments for select using (true);
create policy "mindenki olvashatja" on public.tournament_entries for select using (true);
create policy "mindenki olvashatja" on public.tournament_games for select using (true);
grant select on public.tournaments, public.tournament_entries, public.tournament_games to anon, authenticated;

-- =====================================================================
--  Belső függvények
-- =====================================================================

-- Hány fordulós a kupa (4 → 2, 8 → 3, 16 → 4)
create or replace function public._tour_rounds(p_size integer)
returns integer language sql immutable as $$
  select case p_size when 4 then 2 when 8 then 3 else 4 end;
$$;

-- Ha egy meccsnek megvan mindkét játékosa, onnan indul az óra
create or replace function public._tour_mark_ready(p_tour uuid)
returns void
language sql security definer set search_path = public, extensions as $$
  update public.tournament_games set ready_at = now()
   where tournament_id = p_tour and a is not null and b is not null and winner is null and ready_at is null;
$$;

-- A győztes továbblép: a következő forduló megfelelő helyére, az elődöntő vesztese a bronzmeccsre.
-- A döntő után a kupa kész.
create or replace function public._tour_advance(p_tour uuid, p_round integer, p_slot integer)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.tournaments;
  g public.tournament_games;
  r integer;
  l uuid;
begin
  select * into t from public.tournaments where id = p_tour;
  select * into g from public.tournament_games where tournament_id = p_tour and round = p_round and slot = p_slot;
  r := public._tour_rounds(t.size);
  if p_round = -1 then return; end if;
  if p_round = r - 1 then
    update public.tournaments
       set status = 'done', finished_at = now(), champion = g.winner,
           runner_up = case when g.winner = g.a then g.b else g.a end
     where id = p_tour;
    return;
  end if;
  if p_slot % 2 = 0 then
    update public.tournament_games set a = g.winner where tournament_id = p_tour and round = p_round + 1 and slot = p_slot / 2;
  else
    update public.tournament_games set b = g.winner where tournament_id = p_tour and round = p_round + 1 and slot = p_slot / 2;
  end if;
  if p_round = r - 2 and t.bronze then
    l := case when g.winner = g.a then g.b else g.a end;
    if p_slot % 2 = 0 then
      update public.tournament_games set a = l where tournament_id = p_tour and round = -1 and slot = 0;
    else
      update public.tournament_games set b = l where tournament_id = p_tour and round = -1 and slot = 0;
    end if;
  end if;
  perform public._tour_mark_ready(p_tour);
end $$;

-- Egy eredmény visszavonása (törölt vagy javított meccsnél): a győztes kikerül a következő helyről.
-- Csak akkor lehet, ha a következő meccs (és a bronz) még nincs lejátszva.
create or replace function public._tour_unadvance(p_tour uuid, p_round integer, p_slot integer)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.tournaments;
  r integer;
  nx public.tournament_games;
  br public.tournament_games;
begin
  select * into t from public.tournaments where id = p_tour for update;
  r := public._tour_rounds(t.size);
  if p_round = -1 then return; end if;
  if p_round = r - 1 then
    update public.tournaments set status = 'running', finished_at = null, champion = null, runner_up = null where id = p_tour;
    return;
  end if;
  select * into nx from public.tournament_games where tournament_id = p_tour and round = p_round + 1 and slot = p_slot / 2;
  select * into br from public.tournament_games where tournament_id = p_tour and round = -1 and slot = 0;
  if nx.winner is not null or (p_round = r - 2 and br.winner is not null) then
    raise exception 'Ez egy kupameccs, és a következő kör már lejátszódott. Előbb a későbbi kupameccset javítsd vagy töröld.';
  end if;
  if p_slot % 2 = 0 then
    update public.tournament_games set a = null, ready_at = null where tournament_id = p_tour and round = p_round + 1 and slot = p_slot / 2;
  else
    update public.tournament_games set b = null, ready_at = null where tournament_id = p_tour and round = p_round + 1 and slot = p_slot / 2;
  end if;
  if p_round = r - 2 and t.bronze then
    if p_slot % 2 = 0 then
      update public.tournament_games set a = null, ready_at = null where tournament_id = p_tour and round = -1 and slot = 0;
    else
      update public.tournament_games set b = null, ready_at = null where tournament_id = p_tour and round = -1 and slot = 0;
    end if;
  end if;
end $$;

-- Sorsolás: a két legerősebb (ELO) az ágrajz két végére, a többi véletlenszerűen.
-- Ha nem telt be, kisebb ágrajz lesz (pl. 6 nevezőnél 8-as), és a legerősebbek kapnak erőnyerőt;
-- egy párharcban sosem lesz két üres hely.
create or replace function public._tour_draw(p_tour uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.tournaments;
  n integer;
  sz integer;
  rr integer;
  g0 integer;
  byes integer;
  seeded integer;
  ids uuid[];
  rest uuid[];
  slots uuid[];
  filled boolean[];
  ord integer[];
  k integer;
  pos integer;
  q integer := 1;
  i integer;
  r integer;
  g record;
begin
  select * into t from public.tournaments where id = p_tour for update;
  if t.status <> 'reg' then return; end if;
  select count(*) into n from public.tournament_entries where tournament_id = p_tour;
  sz := greatest(4, (2 ^ ceil(log(2, greatest(n, 2)::numeric)))::integer);
  rr := public._tour_rounds(sz);
  g0 := sz / 2;
  byes := sz - n;
  seeded := greatest(2, byes);

  -- ELO szerinti sorrend (a sorsoláskori pontszám elmentve)
  update public.tournament_entries e set elo = p.elo from public.players p where p.id = e.player_id and e.tournament_id = p_tour;
  select array_agg(player_id order by elo desc, joined_at) into ids from public.tournament_entries where tournament_id = p_tour;
  update public.tournament_entries e set seed = s.k
    from (select player_id, row_number() over (order by elo desc, joined_at) k from public.tournament_entries where tournament_id = p_tour) s
   where e.tournament_id = p_tour and e.player_id = s.player_id;

  -- a párharcok sorrendje felváltva a két végről befelé (0, g0-1, 1, g0-2, ...)
  ord := array[]::integer[];
  for k in 0 .. g0 - 1 loop
    ord := ord || case when k % 2 = 1 then g0 - 1 - (k / 2) else k / 2 end;
  end loop;
  slots := array_fill(null::uuid, array[sz]);
  filled := array_fill(false, array[sz]);
  for k in 0 .. least(seeded, n) - 1 loop
    pos := case when k % 2 = 1 then 2 * ord[k + 1] + 1 else 2 * ord[k + 1] end;   -- 0-tól számolt hely
    slots[pos + 1] := ids[k + 1]; filled[pos + 1] := true;
    if k < byes then
      filled[(pos # 1) + 1] := true;   -- mellette erőnyerő (üres) hely
    end if;
  end loop;
  -- a többiek véletlen sorrendben a maradék helyekre
  select coalesce(array_agg(x order by random()), array[]::uuid[]) into rest from unnest(ids[seeded + 1:]) x;
  for i in 1 .. sz loop
    if not filled[i] then
      slots[i] := rest[q]; q := q + 1; filled[i] := true;
    end if;
  end loop;

  for r in 0 .. rr - 1 loop
    for i in 0 .. (sz >> (r + 1)) - 1 loop
      insert into public.tournament_games (tournament_id, round, slot, a, b)
      values (p_tour, r, i, case when r = 0 then slots[2 * i + 1] end, case when r = 0 then slots[2 * i + 2] end);
    end loop;
  end loop;
  -- bronzmeccs csak akkor, ha az elődöntőben négy valódi játékos lesz
  if t.bronze and n >= 4 then
    insert into public.tournament_games (tournament_id, round, slot) values (p_tour, -1, 0);
  else
    update public.tournaments set bronze = false where id = p_tour;
  end if;
  update public.tournaments set status = 'running', size = sz, started_at = now() where id = p_tour;

  -- erőnyerők automatikusan tovább
  for g in select * from public.tournament_games where tournament_id = p_tour and round = 0 and (a is null or b is null) order by slot loop
    update public.tournament_games set winner = coalesce(g.a, g.b), walkover = true
     where tournament_id = p_tour and round = 0 and slot = g.slot;
    perform public._tour_advance(p_tour, 0, g.slot);
  end loop;
  perform public._tour_mark_ready(p_tour);
end $$;

-- Karbantartás (minden kupa-művelet elején fut, időzítő nem kell):
-- ha lejárt a jelentkezés, 4+ nevezőnél sorsol, különben a kupa elmarad.
create or replace function public._tour_tick()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.tournaments;
  n integer;
begin
  for t in select * from public.tournaments where status = 'reg' and reg_until <= now() for update loop
    select count(*) into n from public.tournament_entries where tournament_id = t.id;
    if n >= 4 then perform public._tour_draw(t.id);
    else update public.tournaments set status = 'cancelled' where id = t.id;
    end if;
  end loop;
end $$;

-- Kiíró vagy admin?
create or replace function public._tour_boss(p_player public.players, p_tour public.tournaments)
returns boolean language sql stable as $$
  select p_player.is_admin or p_player.id = p_tour.created_by;
$$;

-- A kupa teljes állapota JSON-ban (nevezők + híd)
create or replace function public._tour_json(p_tour uuid)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'size', t.size, 'bronze', t.bronze, 'msg', t.message, 'status', t.status,
    'by', t.created_by, 'created', t.created_at, 'until', t.reg_until, 'hours', t.round_hours,
    'started', t.started_at, 'finished', t.finished_at, 'champion', t.champion, 'runnerUp', t.runner_up,
    'entries', coalesce((select jsonb_agg(jsonb_build_object('p', e.player_id, 'elo', e.elo, 'seed', e.seed) order by e.joined_at)
                           from public.tournament_entries e where e.tournament_id = t.id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('r', g.round, 'i', g.slot, 'a', g.a, 'b', g.b, 'w', g.winner,
                                         'sa', g.score_a, 'sb', g.score_b, 'm', g.match_id, 'wo', g.walkover, 'ready', g.ready_at)
                                       order by g.round, g.slot)
                         from public.tournament_games g where g.tournament_id = t.id), '[]'::jsonb))
  from public.tournaments t where t.id = p_tour;
$$;

-- =====================================================================
--  Olvasás (az app ezeket hívja)
-- =====================================================================

-- Indításkor és a Bajnokság fülön: a nyitott kupa (vagy a legutóbbi kész kupa),
-- és a legutóbbi bajnok (a címvédő babérhoz). Egyszerre kb. 1–3 KB.
create or replace function public.tournament_state()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cup uuid;
  v_last public.tournaments;
begin
  perform public._tour_tick();
  select id into v_cup from public.tournaments where status in ('reg', 'running');
  select * into v_last from public.tournaments where status = 'done' order by finished_at desc limit 1;
  return jsonb_build_object(
    'cup', public._tour_json(coalesce(v_cup, v_last.id)),
    'last', case when v_last.id is null then null
                 else jsonb_build_object('id', v_last.id, 'champion', v_last.champion, 'at', v_last.finished_at) end,
    'cups', (select count(*) from public.tournaments where status = 'done'));
end $$;

-- A Hírlaphoz és a Csarnokhoz: a lezárt kupák (csak az adott időpont utániak, így a telefon
-- a már letöltötteket nem kéri le újra)
create or replace function public.tournament_archive(p_after timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(public._tour_json(t.id) order by t.finished_at), '[]'::jsonb)
    from public.tournaments t
   where t.status = 'done' and (p_after is null or t.finished_at > p_after);
$$;

-- =====================================================================
--  Műveletek
-- =====================================================================

-- Kiírás: bárki kiírhat, ha nincs nyitott kupa. A kiíró automatikusan nevez.
create or replace function public.tournament_create(
  p_token uuid, p_size integer, p_bronze boolean default true, p_message text default null, p_reg_days integer default 2)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  v_id uuid;
begin
  perform public._tour_tick();
  if p_size not in (4, 8, 16) then return jsonb_build_object('error', '4, 8 vagy 16 fős lehet a kupa.'); end if;
  if p_reg_days not in (1, 2, 3) then return jsonb_build_object('error', 'A jelentkezés 1–3 napig tarthat.'); end if;
  if exists (select 1 from public.tournaments where status in ('reg', 'running')) then
    return jsonb_build_object('error', 'Már fut egy Lánchíd Kupa, egyszerre csak egy lehet.');
  end if;
  insert into public.tournaments (size, bronze, message, created_by, reg_until)
  values (p_size, coalesce(p_bronze, true), nullif(left(trim(coalesce(p_message, '')), 140), ''), me.id,
          now() + make_interval(days => p_reg_days))
  returning id into v_id;
  insert into public.tournament_entries (tournament_id, player_id) values (v_id, me.id);
  return jsonb_build_object('tournament_id', v_id);
exception when unique_violation then
  return jsonb_build_object('error', 'Már fut egy Lánchíd Kupa, egyszerre csak egy lehet.');
end $$;

-- Nevezés. Ha betelt, azonnal sorsol.
create or replace function public.tournament_join(p_token uuid, p_tour uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.tournaments;
  n integer;
begin
  perform public._tour_tick();
  select * into t from public.tournaments where id = p_tour for update;
  if t.id is null or t.status <> 'reg' then return jsonb_build_object('error', 'Erre a kupára már nem lehet jelentkezni.'); end if;
  if exists (select 1 from public.tournament_entries where tournament_id = t.id and player_id = me.id) then
    return jsonb_build_object('error', 'Már jelentkeztél.');
  end if;
  select count(*) into n from public.tournament_entries where tournament_id = t.id;
  if n >= t.size then return jsonb_build_object('error', 'Betelt a kupa.'); end if;
  insert into public.tournament_entries (tournament_id, player_id) values (t.id, me.id);
  if n + 1 >= t.size then
    perform public._tour_draw(t.id);
    return jsonb_build_object('ok', true, 'drawn', true);
  end if;
  return jsonb_build_object('ok', true, 'drawn', false);
end $$;

-- Visszalépés a sorsolásig. Ha mindenki visszalépett, a kupa elmarad.
create or replace function public.tournament_leave(p_token uuid, p_tour uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.tournaments;
begin
  perform public._tour_tick();
  select * into t from public.tournaments where id = p_tour for update;
  if t.id is null or t.status <> 'reg' then return jsonb_build_object('error', 'A sorsolás után már nem lehet visszalépni.'); end if;
  delete from public.tournament_entries where tournament_id = t.id and player_id = me.id;
  if not found then return jsonb_build_object('error', 'Nem vagy a nevezők között.'); end if;
  if not exists (select 1 from public.tournament_entries where tournament_id = t.id) then
    update public.tournaments set status = 'cancelled' where id = t.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Sorsolás most (a kiíró vagy az admin, legalább 4 nevezővel)
create or replace function public.tournament_draw(p_token uuid, p_tour uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.tournaments;
begin
  perform public._tour_tick();
  select * into t from public.tournaments where id = p_tour for update;
  if t.id is null or t.status <> 'reg' then return jsonb_build_object('error', 'Ez a kupa már elindult.'); end if;
  if not public._tour_boss(me, t) then return jsonb_build_object('error', 'A sorsolást a kiíró vagy az admin indíthatja.'); end if;
  if (select count(*) from public.tournament_entries where tournament_id = t.id) < 4 then
    return jsonb_build_object('error', 'Legalább 4 nevező kell a sorsoláshoz.');
  end if;
  perform public._tour_draw(t.id);
  return jsonb_build_object('ok', true);
end $$;

-- Kupa törlése (amíg jelentkezős: a kiíró vagy az admin; zajló kupát csak az admin).
-- A már lejátszott meccsek és az ELO megmaradnak.
create or replace function public.tournament_cancel(p_token uuid, p_tour uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tour for update;
  if t.id is null or t.status not in ('reg', 'running') then return jsonb_build_object('error', 'Ez a kupa már lezárult.'); end if;
  if not (me.is_admin or (t.status = 'reg' and me.id = t.created_by)) then
    return jsonb_build_object('error', case when t.status = 'reg' then 'Csak a kiíró vagy az admin törölheti.' else 'Zajló kupát csak az admin törölhet.' end);
  end if;
  update public.tournaments set status = 'cancelled' where id = t.id;
  return jsonb_build_object('ok', true);
end $$;

-- Továbbléptetés meccs nélkül (pl. valaki hazautazott): a kiíró a határidő után, az admin bármikor. Nem jár ELO.
create or replace function public.tournament_walkover(p_token uuid, p_tour uuid, p_round integer, p_slot integer, p_winner uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.tournaments;
  g public.tournament_games;
begin
  select * into t from public.tournaments where id = p_tour for update;
  if t.id is null or t.status <> 'running' then return jsonb_build_object('error', 'Ez a kupa nem zajlik.'); end if;
  select * into g from public.tournament_games where tournament_id = t.id and round = p_round and slot = p_slot for update;
  if g.a is null or g.b is null or g.winner is not null then return jsonb_build_object('error', 'Ez a meccs nem vár eredményre.'); end if;
  if p_winner not in (g.a, g.b) then return jsonb_build_object('error', 'A továbbjutó csak a két játékos egyike lehet.'); end if;
  if not public._tour_boss(me, t) then return jsonb_build_object('error', 'Továbbléptetni a kiíró vagy az admin tud.'); end if;
  if not me.is_admin and g.ready_at + make_interval(hours => t.round_hours) > now() then
    return jsonb_build_object('error', 'A kiíró csak ' || t.round_hours || ' óra után léptethet tovább valakit.');
  end if;
  update public.tournament_games set winner = p_winner, walkover = true where tournament_id = t.id and round = p_round and slot = p_slot;
  perform public._tour_advance(t.id, p_round, p_slot);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Egyéni meccs rögzítése: most már kupameccsként is ----------
-- p_tournament: a kupa azonosítója; a két játékos aktuális kupameccsét keresi meg. A döntő 2x pontot ér.
drop function if exists public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text, uuid);
create or replace function public.record_match(
  p_token uuid, p_winner uuid, p_loser uuid,
  p_score_w integer default null, p_score_l integer default null, p_note text default null,
  p_pin_player uuid default null, p_pin text default null, p_challenge uuid default null,
  p_tournament uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  recorder public.players := public._session_player(p_token);
  w public.players;
  l public.players;
  c public.challenges;
  t public.tournaments;
  g public.tournament_games;
  err text;
  d integer;
  mult numeric := 1;
  v_match uuid;
begin
  if p_winner is null or p_loser is null or p_winner = p_loser then
    return jsonb_build_object('error', 'Válassz két különböző játékost.');
  end if;
  if p_challenge is not null and p_tournament is not null then
    return jsonb_build_object('error', 'Egy meccs nem lehet egyszerre kihívás és kupameccs.');
  end if;
  err := public._score_error(p_score_w, p_score_l);
  if err is not null then return jsonb_build_object('error', err); end if;

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
    if err is not null then return jsonb_build_object('error', err); end if;
  end if;

  if exists (
    select 1 from public.matches m
    where m.recorded_by = recorder.id and m.kind = 'singles' and m.played_at > now() - interval '15 seconds'
      and (select count(*) from public.match_players mp
           where mp.match_id = m.id and mp.player_id in (w.id, l.id)) = 2
  ) then
    return jsonb_build_object('error', 'Ezt a meccset épp most rögzítetted.');
  end if;

  if p_challenge is not null then
    select * into c from public.challenges where id = p_challenge for update;
    if c.id is null or c.status <> 'accepted' or c.play_by <= now()
       or not ((c.challenger = w.id and c.challenged = l.id) or (c.challenger = l.id and c.challenged = w.id)) then
      return jsonb_build_object('error', 'Ez a kihívás már lejárt, vagy nem ennek a két játékosnak szól.');
    end if;
    mult := 1.5;
  end if;

  if p_tournament is not null then
    select * into t from public.tournaments where id = p_tournament for update;
    select * into g from public.tournament_games
     where tournament_id = p_tournament and winner is null
       and ((a = w.id and b = l.id) or (a = l.id and b = w.id))
     order by round desc limit 1 for update;
    if t.id is null or t.status <> 'running' or g.tournament_id is null then
      return jsonb_build_object('error', 'Ennek a két játékosnak most nincs kupameccse.');
    end if;
    if g.round = public._tour_rounds(t.size) - 1 then mult := 2; end if;
  end if;

  d := public._elo_delta(w.elo, l.elo, mult);
  insert into public.matches (kind, winner_side, score_1, score_2, note, recorded_by, multiplier, challenge_id, tournament_id)
  values ('singles', 1, p_score_w, p_score_l, public._clean_note(p_note), recorder.id, mult, c.id, t.id)
  returning id into v_match;
  insert into public.match_players (match_id, player_id, side, elo_before, elo_after) values
    (v_match, w.id, 1, w.elo, w.elo + d),
    (v_match, l.id, 2, l.elo, l.elo - d);
  update public.players set elo = elo + d where id = w.id;
  update public.players set elo = elo - d where id = l.id;
  if c.id is not null then
    update public.challenges set status = 'played', match_id = v_match where id = c.id;
  end if;
  if g.tournament_id is not null then
    update public.tournament_games
       set winner = w.id, match_id = v_match,
           score_a = case when a = w.id then p_score_w else p_score_l end,
           score_b = case when b = w.id then p_score_w else p_score_l end
     where tournament_id = g.tournament_id and round = g.round and slot = g.slot;
    perform public._tour_advance(g.tournament_id, g.round, g.slot);
  end if;
  return jsonb_build_object('match_id', v_match, 'delta', d,
    'tournament', case when g.tournament_id is null then null
                       else jsonb_build_object('round', g.round, 'slot', g.slot,
                              'final', g.round = public._tour_rounds(t.size) - 1) end);
end $$;

-- ---------- Admin javítás/törlés kupameccsen ----------
-- Ha az admin egy kupameccset töröl vagy átír, a híd is követi.
-- (Ha a következő kör már lejátszódott, hibát ad: előbb azt kell javítani.)
create or replace function public._tour_match_changed()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.tournament_games;
  w uuid;
  s1 integer;
  s2 integer;
  pa integer;
begin
  select * into g from public.tournament_games where match_id = old.id;
  if g.tournament_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    perform public._tour_unadvance(g.tournament_id, g.round, g.slot);
    update public.tournament_games set winner = null, score_a = null, score_b = null, match_id = null, ready_at = now()
     where tournament_id = g.tournament_id and round = g.round and slot = g.slot;
    return old;
  end if;
  -- javítás: új győztes és pontszám a meccs oldalai alapján
  select mp.side into pa from public.match_players mp where mp.match_id = new.id and mp.player_id = g.a;
  w := case when pa = new.winner_side then g.a else g.b end;
  s1 := case when pa = 1 then new.score_1 else new.score_2 end;
  s2 := case when pa = 1 then new.score_2 else new.score_1 end;
  if w is distinct from g.winner then
    perform public._tour_unadvance(g.tournament_id, g.round, g.slot);
    update public.tournament_games set winner = w, score_a = s1, score_b = s2
     where tournament_id = g.tournament_id and round = g.round and slot = g.slot;
    perform public._tour_advance(g.tournament_id, g.round, g.slot);
  else
    update public.tournament_games set score_a = s1, score_b = s2
     where tournament_id = g.tournament_id and round = g.round and slot = g.slot;
  end if;
  return new;
end $$;
drop trigger if exists tour_match_changed on public.matches;
create trigger tour_match_changed
  before delete or update of winner_side, score_1, score_2 on public.matches
  for each row when (old.tournament_id is not null)
  execute function public._tour_match_changed();

-- ---------- Jogosultságok ----------
revoke execute on function
  public._tour_rounds(integer),
  public._tour_mark_ready(uuid),
  public._tour_advance(uuid, integer, integer),
  public._tour_unadvance(uuid, integer, integer),
  public._tour_draw(uuid),
  public._tour_tick(),
  public._tour_boss(public.players, public.tournaments),
  public._tour_json(uuid),
  public._tour_match_changed(),
  public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text, uuid, uuid),
  public.tournament_state(),
  public.tournament_archive(timestamptz),
  public.tournament_create(uuid, integer, boolean, text, integer),
  public.tournament_join(uuid, uuid),
  public.tournament_leave(uuid, uuid),
  public.tournament_draw(uuid, uuid),
  public.tournament_cancel(uuid, uuid),
  public.tournament_walkover(uuid, uuid, integer, integer, uuid)
from public, anon, authenticated;
grant execute on function
  public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text, uuid, uuid),
  public.tournament_state(),
  public.tournament_archive(timestamptz),
  public.tournament_create(uuid, integer, boolean, text, integer),
  public.tournament_join(uuid, uuid),
  public.tournament_leave(uuid, uuid),
  public.tournament_draw(uuid, uuid),
  public.tournament_cancel(uuid, uuid),
  public.tournament_walkover(uuid, uuid, integer, integer, uuid)
to anon, authenticated;

-- ---------- Élő frissítés a kupákra is ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournaments') then
    alter publication supabase_realtime add table public.tournaments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournament_entries') then
    alter publication supabase_realtime add table public.tournament_entries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournament_games') then
    alter publication supabase_realtime add table public.tournament_games;
  end if;
end $$;

-- Kész! 🏆
