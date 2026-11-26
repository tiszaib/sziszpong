-- =====================================================================
--  SZISZpong – 3. frissítés: kihívások (1,5x pontos egyéni meccsek)
--  Másold be az egészet a Supabase "SQL Editor"-ába, és nyomd meg a Run gombot.
--  A meglévő játékosok és meccsek megmaradnak, a régi meccsek szorzója 1 lesz.
--  FONTOS: előbb ezt futtasd le, és csak utána mergeld az app frissítését.
--  (A mostani app ezzel az SQL-lel is gond nélkül működik tovább.)
-- =====================================================================

-- ---------- Kihívások ----------
-- status: pending (vár válaszra) → accepted (elfogadva) → played (lejátszva)
--         mellékágak: declined (nem vállalta), cancelled (visszavonta), expired (lejárt)
-- A lejáratot nem kell időzítő: ha a határidő elmúlt, mindenki lejártnak tekinti,
-- és a következő kihívás-műveletnél a táblában is átíródik.
create table if not exists public.challenges (
  id            uuid primary key default gen_random_uuid(),
  challenger    uuid not null references public.players(id) on delete cascade,
  challenged    uuid not null references public.players(id) on delete cascade,
  message       text check (message is null or char_length(message) <= 140),
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'played')),
  created_at    timestamptz not null default now(),
  answer_by     timestamptz not null default now() + interval '6 hours',
  responded_at  timestamptz,
  play_by       timestamptz,
  match_id      uuid references public.matches(id) on delete set null,
  check (challenger <> challenged)
);
create index if not exists challenges_created_idx on public.challenges (created_at desc);

-- ---------- Meccsek: szorzó (és hely a későbbi tornának) ----------
alter table public.matches add column if not exists multiplier numeric(3,2) not null default 1
  check (multiplier > 0 and multiplier <= 5);
alter table public.matches add column if not exists challenge_id uuid references public.challenges(id) on delete set null;
alter table public.matches add column if not exists tournament_id uuid;   -- a tornához, most még üres

-- ---------- Olvasási jog: mindenki látja a kihívásokat (mint a meccseket) ----------
alter table public.challenges enable row level security;
drop policy if exists "mindenki olvashatja" on public.challenges;
create policy "mindenki olvashatja" on public.challenges for select using (true);
grant select on public.challenges to anon, authenticated;

-- ---------- ELO szorzóval ----------
-- Ugyanaz a képlet, mint eddig, csak a K (32) szorozva: kihívásban 48.
create or replace function public._elo_delta(winner_elo integer, loser_elo integer, mult numeric)
returns integer language sql immutable as $$
  select greatest(1, round(32 * mult * (1 - 1 / (1 + power(10, (loser_elo - winner_elo) / 400.0)))))::integer;
$$;

-- Minden ELO újraszámolása az elejétől: most már a meccs szorzójával
create or replace function public._recompute_all()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  w_elo numeric;
  l_elo numeric;
  d integer;
begin
  update public.players set elo = 1000, elo_doubles = 1000 where true;
  for m in select id, kind, winner_side, multiplier from public.matches order by played_at, id loop
    if m.kind = 'singles' then
      select avg(p.elo) into w_elo from public.match_players mp join public.players p on p.id = mp.player_id
       where mp.match_id = m.id and mp.side = m.winner_side;
      select avg(p.elo) into l_elo from public.match_players mp join public.players p on p.id = mp.player_id
       where mp.match_id = m.id and mp.side <> m.winner_side;
    else
      select avg(p.elo_doubles) into w_elo from public.match_players mp join public.players p on p.id = mp.player_id
       where mp.match_id = m.id and mp.side = m.winner_side;
      select avg(p.elo_doubles) into l_elo from public.match_players mp join public.players p on p.id = mp.player_id
       where mp.match_id = m.id and mp.side <> m.winner_side;
    end if;
    d := public._elo_delta(round(w_elo)::int, round(l_elo)::int, m.multiplier);
    update public.match_players mp
       set elo_before = case when m.kind = 'singles' then p.elo else p.elo_doubles end,
           elo_after  = case when m.kind = 'singles' then p.elo else p.elo_doubles end
                        + case when mp.side = m.winner_side then d else -d end
      from public.players p
     where p.id = mp.player_id and mp.match_id = m.id;
    if m.kind = 'singles' then
      update public.players p set elo = mp.elo_after
        from public.match_players mp where mp.player_id = p.id and mp.match_id = m.id;
    else
      update public.players p set elo_doubles = mp.elo_after
        from public.match_players mp where mp.player_id = p.id and mp.match_id = m.id;
    end if;
  end loop;
end $$;

-- Lejárt kihívások átírása (minden kihívás-művelet elején fut)
create or replace function public._expire_challenges()
returns void
language sql security definer set search_path = public, extensions as $$
  update public.challenges set status = 'expired'
   where (status = 'pending' and answer_by <= now())
      or (status = 'accepted' and play_by <= now());
$$;

-- Van-e nyitott (még nem lejárt) kihívása valakinek
create or replace function public._has_open_challenge(p_player uuid)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.challenges c
     where p_player in (c.challenger, c.challenged)
       and ((c.status = 'pending' and c.answer_by > now()) or (c.status = 'accepted' and c.play_by > now()))
  );
$$;

-- ---------- Kihívás küldése ----------
create or replace function public.challenge_create(p_token uuid, p_target uuid, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  t public.players;
  v_id uuid;
  v_until timestamptz;
begin
  perform public._expire_challenges();
  select * into t from public.players where id = p_target and active;
  if t.id is null then return jsonb_build_object('error', 'Ismeretlen játékos.'); end if;
  if t.id = me.id then return jsonb_build_object('error', 'Magadat nem hívhatod ki.'); end if;

  -- egyszerre csak egy kihívás (a két érintett sorrendben zárolva, hogy két kérés ne fusson össze)
  perform 1 from public.players where id in (me.id, t.id) order by id for update;
  if public._has_open_challenge(me.id) then
    return jsonb_build_object('error', 'Már van nyitott kihívásod.');
  end if;
  if public._has_open_challenge(t.id) then
    return jsonb_build_object('error', t.name || ' már benne van egy kihívásban.');
  end if;

  -- ha nemet mondott, 3 napig nem hívhatod ki újra
  select max(c.responded_at) + interval '3 days' into v_until
    from public.challenges c
   where c.challenger = me.id and c.challenged = t.id and c.status = 'declined'
     and c.responded_at > now() - interval '3 days';
  if v_until is not null then
    return jsonb_build_object('error', 'Nemrég nemet mondott, ' || to_char(v_until at time zone 'Europe/Budapest', 'MM.DD. HH24:MI') || '-ig nem hívhatod ki újra.');
  end if;

  -- egy pár 24 órán belül csak egy kihívást játszhat
  if exists (
    select 1 from public.challenges c join public.matches m on m.id = c.match_id
     where c.status = 'played' and m.played_at > now() - interval '24 hours'
       and ((c.challenger = me.id and c.challenged = t.id) or (c.challenger = t.id and c.challenged = me.id))
  ) then
    return jsonb_build_object('error', '24 órán belül csak egy kihívást játszhattok egymással.');
  end if;

  insert into public.challenges (challenger, challenged, message)
  values (me.id, t.id, nullif(left(trim(coalesce(p_message, '')), 140), ''))
  returning id into v_id;
  return jsonb_build_object('challenge_id', v_id);
end $$;

-- ---------- Válasz: elfogad / nem most (csak a kihívott) ----------
create or replace function public.challenge_respond(p_token uuid, p_challenge uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
  c public.challenges;
begin
  perform public._expire_challenges();
  select * into c from public.challenges where id = p_challenge for update;
  if c.id is null or c.challenged <> me.id then
    return jsonb_build_object('error', 'Ez a kihívás nem neked szól.');
  end if;
  if c.status <> 'pending' then
    return jsonb_build_object('error', case c.status when 'expired' then 'Ez a kihívás már lejárt.'
                                                     when 'cancelled' then 'A kihívó visszavonta.'
                                                     else 'Erre már válaszoltál.' end);
  end if;
  if p_accept then
    update public.challenges set status = 'accepted', responded_at = now(), play_by = now() + interval '24 hours'
     where id = c.id;
  else
    update public.challenges set status = 'declined', responded_at = now() where id = c.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Visszavonás (csak a kihívó, amíg nincs válasz) ----------
create or replace function public.challenge_cancel(p_token uuid, p_challenge uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.players := public._session_player(p_token);
begin
  perform public._expire_challenges();
  update public.challenges set status = 'cancelled', responded_at = now()
   where id = p_challenge and challenger = me.id and status = 'pending';
  if not found then
    return jsonb_build_object('error', 'Ezt a kihívást már nem lehet visszavonni.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Egyéni meccs rögzítése: most már kihívással is ----------
drop function if exists public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text);
create or replace function public.record_match(
  p_token uuid, p_winner uuid, p_loser uuid,
  p_score_w integer default null, p_score_l integer default null, p_note text default null,
  p_pin_player uuid default null, p_pin text default null, p_challenge uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  recorder public.players := public._session_player(p_token);
  w public.players;
  l public.players;
  c public.challenges;
  err text;
  d integer;
  mult numeric := 1;
  v_match uuid;
begin
  if p_winner is null or p_loser is null or p_winner = p_loser then
    return jsonb_build_object('error', 'Válassz két különböző játékost.');
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

  d := public._elo_delta(w.elo, l.elo, mult);
  insert into public.matches (kind, winner_side, score_1, score_2, note, recorded_by, multiplier, challenge_id)
  values ('singles', 1, p_score_w, p_score_l, public._clean_note(p_note), recorder.id, mult, c.id)
  returning id into v_match;
  insert into public.match_players (match_id, player_id, side, elo_before, elo_after) values
    (v_match, w.id, 1, w.elo, w.elo + d),
    (v_match, l.id, 2, l.elo, l.elo - d);
  update public.players set elo = elo + d where id = w.id;
  update public.players set elo = elo - d where id = l.id;
  if c.id is not null then
    update public.challenges set status = 'played', match_id = v_match where id = c.id;
  end if;
  return jsonb_build_object('match_id', v_match, 'delta', d);
end $$;

-- ---------- Jogosultságok ----------
-- A belső (_ kezdetű) függvényeket kívülről senki nem hívhatja, a többit a bejelentkezett app igen.
revoke execute on function
  public._elo_delta(integer, integer, numeric),
  public._expire_challenges(),
  public._has_open_challenge(uuid),
  public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text, uuid),
  public.challenge_create(uuid, uuid, text),
  public.challenge_respond(uuid, uuid, boolean),
  public.challenge_cancel(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text, uuid),
  public.challenge_create(uuid, uuid, text),
  public.challenge_respond(uuid, uuid, boolean),
  public.challenge_cancel(uuid, uuid)
to anon, authenticated;

-- ---------- Élő frissítés a kihívásokra is ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenges') then
    alter publication supabase_realtime add table public.challenges;
  end if;
end $$;

-- Kész! ⚔️
