-- FLUA plan: 4 classes per week, at most 1 per day (both adjustable per student by the teacher).

alter table public.student_settings alter column classes_per_week set default 4;
alter table public.student_settings add column if not exists classes_per_day int not null default 1 check (classes_per_day between 1 and 4);
update public.student_settings set classes_per_week = 4, classes_per_day = 1;

-- Classes the student has on that calendar day (Sao Paulo time), optionally ignoring one booking.
create or replace function public.day_count(p_student uuid, p_starts_at timestamptz, p_except uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.bookings b
  where b.student_id = p_student and b.status = 'marcada' and (p_except is null or b.id <> p_except)
    and (b.starts_at at time zone 'America/Sao_Paulo')::date = (p_starts_at at time zone 'America/Sao_Paulo')::date;
$$;
revoke all on function public.day_count(uuid, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.check_bookable(p_student uuid, p_starts_at timestamptz, p_except uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare s public.school_settings; st public.student_settings;
begin
  select * into s from public.school_settings ss where ss.id = 1;
  select * into st from public.student_settings x where x.student_id = p_student;
  if not public.is_slot(p_starts_at) then raise exception 'Esse horário não está entre os horários da FLUA.' using errcode = 'P0001'; end if;
  if p_starts_at < now() + make_interval(mins => s.min_notice_minutes) then raise exception 'Esse horário já fechou: marque com pelo menos 2 horas de antecedência.' using errcode = 'P0001'; end if;
  if p_starts_at > now() + make_interval(days => s.booking_days) then raise exception 'Só dá para marcar aulas até 7 dias à frente.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.bookings where starts_at = p_starts_at and status = 'marcada' and (p_except is null or id <> p_except)) then
    raise exception 'Esse horário já está ocupado.' using errcode = 'P0001'; end if;
  if public.day_count(p_student, p_starts_at, p_except) >= coalesce(st.classes_per_day, 1) then
    raise exception 'Você já tem uma aula marcada nesse dia. O plano permite 1 aula por dia.' using errcode = 'P0001'; end if;
  if public.week_count(p_student, p_starts_at, p_except) >= coalesce(st.classes_per_week, 0) then
    raise exception 'Você já usou as aulas do seu plano nessa semana.' using errcode = 'P0001'; end if;
end;
$$;

-- Same as before, plus the state 'day' (the student already has a class that day).
create or replace function public.available_slots()
returns table (starts_at timestamptz, state text)
language plpgsql stable security definer set search_path = '' as $$
declare s public.school_settings; st public.student_settings; me uuid := auth.uid();
begin
  if me is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  select * into s from public.school_settings ss where ss.id = 1;
  select * into st from public.student_settings x where x.student_id = me;
  return query
  with days as (
    select (now() at time zone 'America/Sao_Paulo')::date + g as d from generate_series(0, s.booking_days) g
  ), slots as (
    select ((d + a.start_time) at time zone 'America/Sao_Paulo') as t
    from days join public.availability a on a.weekday = extract(dow from d)::int
  )
  select sl.t,
    case
      when exists (select 1 from public.bookings b where b.starts_at = sl.t and b.status = 'marcada' and b.student_id = me) then 'mine'
      when exists (select 1 from public.bookings b where b.starts_at = sl.t and b.status = 'marcada') then 'taken'
      when public.day_count(me, sl.t) >= coalesce(st.classes_per_day, 1) then 'day'
      when public.week_count(me, sl.t) >= coalesce(st.classes_per_week, 0) then 'limit'
      else 'free'
    end
  from slots sl
  where sl.t >= now() + make_interval(mins => s.min_notice_minutes)
    and sl.t <= now() + make_interval(days => s.booking_days)
  order by sl.t;
end;
$$;

-- my_profile now also returns the daily limit (return type changed, so drop and recreate).
drop function if exists public.my_profile();
create function public.my_profile()
returns table (name text, goal text, interests text, classes_per_week int, classes_per_day int)
language sql stable security definer set search_path = '' as $$
  select p.name, s.goal, s.interests, s.classes_per_week, s.classes_per_day
  from public.profiles p join public.student_settings s on s.student_id = p.id
  where p.id = auth.uid();
$$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
