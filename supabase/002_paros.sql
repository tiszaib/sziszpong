-- =====================================================================
--  SZISZpong – 2. frissítés: páros meccsek, pontszámok, megjegyzés
--  Másold be az egészet a Supabase "SQL Editor"-ába, és nyomd meg a Run gombot.
--  A meglévő játékosok és meccsek megmaradnak.
-- =====================================================================

-- ---------- Új oszlopok ----------
alter table public.players add column if not exists elo_doubles integer not null default 1000;

alter table public.matches add column if not exists score_1 smallint check (score_1 between 0 and 99);
alter table public.matches add column if not exists score_2 smallint check (score_2 between 0 and 99);
alter table public.matches add column if not exists note text check (note is null or char_length(note) <= 300);

-- A régi, szövegként beírt eredmények (pl. "11:7" vagy "3-1") átalakítása számokká.
-- A nagyobb szám a győztes oldalához kerül.
update public.matches m
   set score_1 = case when m.winner_side = 1 then greatest(a, b) else least(a, b) end,
       score_2 = case when m.winner_side = 2 then greatest(a, b) else least(a, b) end
  from (
    select id,
           (regexp_match(score, '^\s*(\d{1,2})\s*[:\-/ ]\s*(\d{1,2})\s*$'))[1]::int as a,
           (regexp_match(score, '^\s*(\d{1,2})\s*[:\-/ ]\s*(\d{1,2})\s*$'))[2]::int as b
      from public.matches
     where score ~ '^\s*\d{1,2}\s*[:\-/ ]\s*\d{1,2}\s*$'
  ) s
 where s.id = m.id and s.a <> s.b;
-- ami nem volt szám (pl. szöveges megjegyzés), az a megjegyzésbe kerül
update public.matches set note = left(score, 300)
 where score is not null and score_1 is null and note is null;

alter table public.matches drop column if exists score;
alter table public.matches drop constraint if exists matches_score_pair;
alter table public.matches add constraint matches_score_pair check ((score_1 is null) = (score_2 is null));

-- ---------- Régi függvények eltávolítása (új paraméterekkel jönnek vissza) ----------
drop function if exists public.record_match(uuid, uuid, uuid, text, uuid, text);
drop function if exists public.admin_update_match(uuid, uuid, uuid, text);
drop function if exists public._clean_score(text);

-- ---------- Segédfüggvények ----------

-- Pontszámok ellenőrzése. NULL = rendben, különben a hibaüzenet.
-- (p_win = a győztes pontja, p_lose = a vesztesé)
create or replace function public._score_error(p_win integer, p_lose integer)
returns text language sql immutable as $$
  select case
    when p_win is null and p_lose is null then null
    when p_win is null or p_lose is null then 'Mindkét pontszámot írd be, vagy egyiket se.'
    when p_win < 0 or p_lose < 0 or p_win > 99 or p_lose > 99 then 'A pontszám 0 és 99 között legyen.'
    when p_win = p_lose then 'Döntetlen nem lehet.'
    when p_win < p_lose then 'A győztesnek kell több pontot szereznie.'
    else null
  end;
$$;

create or replace function public._clean_note(p_note text)
returns text language sql immutable as $$
  select nullif(left(trim(coalesce(p_note, '')), 300), '');
$$;

-- Minden ELO újraszámolása az elejétől (egyéni és páros is)
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
  for m in select id, kind, winner_side from public.matches order by played_at, id loop
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
    d := public._elo_delta(round(w_elo)::int, round(l_elo)::int);
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

-- ---------- Egyéni meccs rögzítése ----------
create or replace function public.record_match(
  p_token uuid, p_winner uuid, p_loser uuid,
  p_score_w integer default null, p_score_l integer default null, p_note text default null,
  p_pin_player uuid default null, p_pin text default null)
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

  d := public._elo_delta(w.elo, l.elo);
  insert into public.matches (kind, winner_side, score_1, score_2, note, recorded_by)
  values ('singles', 1, p_score_w, p_score_l, public._clean_note(p_note), recorder.id)
  returning id into v_match;
  insert into public.match_players (match_id, player_id, side, elo_before, elo_after) values
    (v_match, w.id, 1, w.elo, w.elo + d),
    (v_match, l.id, 2, l.elo, l.elo - d);
  update public.players set elo = elo + d where id = w.id;
  update public.players set elo = elo - d where id = l.id;
  return jsonb_build_object('match_id', v_match, 'delta', d);
end $$;

-- ---------- Páros meccs rögzítése ----------
-- A csapat ereje a két játékos páros-ELO-jának átlaga, mindkét csapattag ugyanannyit kap/veszít.
create or replace function public.record_doubles(
  p_token uuid, p_w1 uuid, p_w2 uuid, p_l1 uuid, p_l2 uuid,
  p_score_w integer default null, p_score_l integer default null, p_note text default null,
  p_pin_player uuid default null, p_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  recorder public.players := public._session_player(p_token);
  ids uuid[] := array[p_w1, p_w2, p_l1, p_l2];
  err text;
  w_avg numeric;
  l_avg numeric;
  d integer;
  v_match uuid;
begin
  if p_w1 is null or p_w2 is null or p_l1 is null or p_l2 is null
     or (select count(distinct x) from unnest(ids) x) <> 4 then
    return jsonb_build_object('error', 'Válassz 4 különböző játékost.');
  end if;
  err := public._score_error(p_score_w, p_score_l);
  if err is not null then return jsonb_build_object('error', err); end if;

  perform 1 from public.players where id = any(ids) order by id for update;
  if (select count(*) from public.players where id = any(ids) and active) <> 4 then
    return jsonb_build_object('error', 'Ismeretlen játékos.');
  end if;

  if not (recorder.id = any(ids)) then
    if p_pin_player is null or not (p_pin_player = any(ids)) then
      return jsonb_build_object('error', 'Az egyik játékos PIN-je kell.');
    end if;
    err := public._check_pin(p_pin_player, p_pin);
    if err is not null then return jsonb_build_object('error', err); end if;
  end if;

  if exists (
    select 1 from public.matches m
    where m.recorded_by = recorder.id and m.kind = 'doubles' and m.played_at > now() - interval '15 seconds'
      and (select count(*) from public.match_players mp
           where mp.match_id = m.id and mp.player_id = any(ids)) = 4
  ) then
    return jsonb_build_object('error', 'Ezt a meccset épp most rögzítetted.');
  end if;

  select avg(elo_doubles) into w_avg from public.players where id in (p_w1, p_w2);
  select avg(elo_doubles) into l_avg from public.players where id in (p_l1, p_l2);
  d := public._elo_delta(round(w_avg)::int, round(l_avg)::int);

  insert into public.matches (kind, winner_side, score_1, score_2, note, recorded_by)
  values ('doubles', 1, p_score_w, p_score_l, public._clean_note(p_note), recorder.id)
  returning id into v_match;
  insert into public.match_players (match_id, player_id, side, elo_before, elo_after)
  select v_match, p.id,
         case when p.id in (p_w1, p_w2) then 1 else 2 end,
         p.elo_doubles,
         p.elo_doubles + case when p.id in (p_w1, p_w2) then d else -d end
    from public.players p where p.id = any(ids);
  update public.players set elo_doubles = elo_doubles + d where id in (p_w1, p_w2);
  update public.players set elo_doubles = elo_doubles - d where id in (p_l1, p_l2);
  return jsonb_build_object('match_id', v_match, 'delta', d);
end $$;

-- ---------- Admin: meccs javítása ----------
-- p_winner_side: melyik oldal nyert (1 vagy 2); p_score_1/p_score_2: az 1. és 2. oldal pontja
create or replace function public.admin_update_match(
  p_token uuid, p_match_id uuid, p_winner_side integer,
  p_score_1 integer default null, p_score_2 integer default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  err text;
begin
  perform public._require_admin(p_token);
  if p_winner_side not in (1, 2) then
    return jsonb_build_object('error', 'Válaszd ki, ki nyert.');
  end if;
  err := case when p_winner_side = 1 then public._score_error(p_score_1, p_score_2)
              else public._score_error(p_score_2, p_score_1) end;
  if err is not null then return jsonb_build_object('error', err); end if;
  update public.matches
     set winner_side = p_winner_side, score_1 = p_score_1, score_2 = p_score_2, note = public._clean_note(p_note)
   where id = p_match_id;
  if not found then return jsonb_build_object('error', 'Nincs ilyen meccs.'); end if;
  perform public._recompute_all();
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Jogosultságok ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.register(text, text, text),
  public.login(uuid, text),
  public.me(uuid),
  public.logout(uuid),
  public.record_match(uuid, uuid, uuid, integer, integer, text, uuid, text),
  public.record_doubles(uuid, uuid, uuid, uuid, uuid, integer, integer, text, uuid, text),
  public.admin_delete_match(uuid, uuid),
  public.admin_update_match(uuid, uuid, integer, integer, integer, text),
  public.admin_rename_player(uuid, uuid, text),
  public.admin_reset_pin(uuid, uuid, text),
  public.admin_remove_player(uuid, uuid),
  public.admin_restore_player(uuid, uuid),
  public.admin_set_reg_code(uuid, text),
  public.admin_set_news(uuid, text, date)
to anon, authenticated;

-- Kész! 🏓🏓
