-- FLUA: class scheduling and attendance.
-- Every rule is enforced here, in the database, so it cannot be bypassed from the browser:
--   * classes are 30 min, on the teacher's weekly slots (Sao Paulo time);
--   * booking opens 7 days ahead and closes 2 hours before the class;
--   * each student has a weekly limit (student_settings.classes_per_week);
--   * one student per slot;
--   * cancel and reschedule until the class starts (the new slot follows the booking rules);
--   * the Meet link is handed out only from the start time until the end, and the first
--     time it is requested counts as the student's attendance.

create table public.school_settings (
  id int primary key default 1 check (id = 1),
  meet_link text not null default '' check (meet_link = '' or meet_link ~ '^https://'),
  class_minutes int not null default 30,
  booking_days int not null default 7,
  min_notice_minutes int not null default 120,
  late_after_minutes int not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.school_settings (id, meet_link) values (1, 'https://meet.google.com/xbj-jdwr-zmj');

create table public.availability (
  id bigint generated always as identity primary key,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time time not null,
  unique (weekday, start_time)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'marcada' check (status in ('marcada', 'desmarcada')),
  joined_at timestamptz,
  attendance text check (attendance in ('presente', 'atraso', 'falta', 'justificada')),  -- teacher's correction
  meet_link text check (meet_link is null or meet_link ~ '^https://'),                  -- optional per-class link
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bookings_one_student_per_slot on public.bookings (starts_at) where status = 'marcada';
create index bookings_student_idx on public.bookings (student_id, starts_at);

alter table public.school_settings enable row level security;
alter table public.availability enable row level security;
alter table public.bookings enable row level security;

-- school_settings holds the Meet link: teacher only.
create policy "settings: teacher reads" on public.school_settings for select to authenticated using (public.is_teacher());
create policy "settings: teacher updates" on public.school_settings for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
revoke insert, delete on public.school_settings from anon, authenticated;

-- availability: everyone logged in reads, the teacher edits.
create policy "availability: read" on public.availability for select to authenticated using (true);
create policy "availability: teacher inserts" on public.availability for insert to authenticated with check (public.is_teacher());
create policy "availability: teacher deletes" on public.availability for delete to authenticated using (public.is_teacher());
revoke update on public.availability from anon, authenticated;

-- bookings: students see only their own rows and only harmless columns (no link, no attendance).
-- All changes go through the functions below. The teacher reads and corrects through functions too.
revoke all on public.bookings from anon, authenticated;
grant select (id, student_id, starts_at, status, created_at) on public.bookings to authenticated;
create policy "bookings: read own or teacher" on public.bookings for select to authenticated using (student_id = auth.uid() or public.is_teacher());
revoke all on public.school_settings, public.availability from anon;

-- Helpers -------------------------------------------------------------------

-- Is this instant one of the teacher's weekly slots (in Sao Paulo time)?
create or replace function public.is_slot(p_starts_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.availability a
    where a.weekday = extract(dow from p_starts_at at time zone 'America/Sao_Paulo')::int
      and a.start_time = (p_starts_at at time zone 'America/Sao_Paulo')::time
  );
$$;

-- Classes the student has that week (Monday to Sunday, Sao Paulo time), optionally ignoring one booking.
create or replace function public.week_count(p_student uuid, p_starts_at timestamptz, p_except uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.bookings b
  where b.student_id = p_student and b.status = 'marcada' and (p_except is null or b.id <> p_except)
    and date_trunc('week', b.starts_at at time zone 'America/Sao_Paulo') = date_trunc('week', p_starts_at at time zone 'America/Sao_Paulo');
$$;

-- Raises a readable error if a student cannot take this slot now.
create or replace function public.check_bookable(p_student uuid, p_starts_at timestamptz, p_except uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare s public.school_settings; lim int;
begin
  select * into s from public.school_settings ss where ss.id = 1;
  if not public.is_slot(p_starts_at) then raise exception 'Esse horário não está entre os horários da FLUA.' using errcode = 'P0001'; end if;
  if p_starts_at < now() + make_interval(mins => s.min_notice_minutes) then raise exception 'Esse horário já fechou: marque com pelo menos 2 horas de antecedência.' using errcode = 'P0001'; end if;
  if p_starts_at > now() + make_interval(days => s.booking_days) then raise exception 'Só dá para marcar aulas até 7 dias à frente.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.bookings where starts_at = p_starts_at and status = 'marcada' and (p_except is null or id <> p_except)) then
    raise exception 'Esse horário já está ocupado.' using errcode = 'P0001'; end if;
  select classes_per_week into lim from public.student_settings where student_id = p_student;
  if public.week_count(p_student, p_starts_at, p_except) >= coalesce(lim, 0) then
    raise exception 'Você já usou as aulas do seu plano nessa semana.' using errcode = 'P0001'; end if;
end;
$$;

-- Student functions -----------------------------------------------------------

-- Open slots for the caller: next 7 days, at least 2 hours ahead. Other students' names never leave the database.
create or replace function public.available_slots()
returns table (starts_at timestamptz, state text)
language plpgsql stable security definer set search_path = '' as $$
declare s public.school_settings; lim int; me uuid := auth.uid();
begin
  if me is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  select * into s from public.school_settings ss where ss.id = 1;
  select classes_per_week into lim from public.student_settings where student_id = me;
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
      when public.week_count(me, sl.t) >= coalesce(lim, 0) then 'limit'
      else 'free'
    end
  from slots sl
  where sl.t >= now() + make_interval(mins => s.min_notice_minutes)
    and sl.t <= now() + make_interval(days => s.booking_days)
  order by sl.t;
end;
$$;

create or replace function public.book_class(p_starts_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(me::text));   -- one booking at a time per student (weekly limit)
  perform public.check_bookable(me, p_starts_at);
  begin
    insert into public.bookings (student_id, starts_at) values (me, p_starts_at) returning id into new_id;
  exception when unique_violation then
    raise exception 'Esse horário acabou de ser ocupado.' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.cancel_class(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_id and student_id = auth.uid() for update;
  if not found or b.status <> 'marcada' then raise exception 'Aula não encontrada.' using errcode = 'P0001'; end if;
  if now() >= b.starts_at then raise exception 'A aula já começou e não pode mais ser desmarcada.' using errcode = 'P0001'; end if;
  update public.bookings set status = 'desmarcada', updated_at = now(),
    history = history || jsonb_build_object('action', 'desmarcada', 'at', now())
  where id = p_id;
end;
$$;

create or replace function public.reschedule_class(p_id uuid, p_new_starts_at timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; me uuid := auth.uid();
begin
  if me is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(me::text));
  select * into b from public.bookings where id = p_id and student_id = me for update;
  if not found or b.status <> 'marcada' then raise exception 'Aula não encontrada.' using errcode = 'P0001'; end if;
  if now() >= b.starts_at then raise exception 'A aula já começou e não pode mais ser remarcada.' using errcode = 'P0001'; end if;
  perform public.check_bookable(me, p_new_starts_at, p_id);
  begin
    update public.bookings set starts_at = p_new_starts_at, updated_at = now(),
      history = history || jsonb_build_object('action', 'remarcada', 'from', b.starts_at, 'at', now())
    where id = p_id;
  exception when unique_violation then
    raise exception 'Esse horário acabou de ser ocupado.' using errcode = 'P0001';
  end;
end;
$$;

-- Hands out the Meet link only during the class and records the first entry as attendance.
create or replace function public.join_class(p_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; s public.school_settings;
begin
  select * into s from public.school_settings ss where ss.id = 1;
  select * into b from public.bookings where id = p_id and student_id = auth.uid() for update;
  if not found or b.status <> 'marcada' then raise exception 'Aula não encontrada.' using errcode = 'P0001'; end if;
  if now() < b.starts_at then raise exception 'A aula ainda não começou. O botão libera no horário exato.' using errcode = 'P0001'; end if;
  if now() >= b.starts_at + make_interval(mins => s.class_minutes) then raise exception 'Essa aula já terminou.' using errcode = 'P0001'; end if;
  if b.joined_at is null then update public.bookings set joined_at = now() where id = p_id; end if;
  return coalesce(nullif(b.meet_link, ''), s.meet_link);
end;
$$;

-- Teacher functions ---------------------------------------------------------------

create or replace function public.teacher_bookings(p_student uuid default null, p_from timestamptz default now() - interval '60 days')
returns table (id uuid, student_id uuid, student_name text, starts_at timestamptz, status text, joined_at timestamptz,
               attendance text, auto_attendance text, meet_link text, history jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare s public.school_settings;
begin
  if not public.is_teacher() then raise exception 'Só o professor.' using errcode = '42501'; end if;
  select * into s from public.school_settings ss where ss.id = 1;
  return query
  select b.id, b.student_id, p.name, b.starts_at, b.status, b.joined_at, b.attendance,
    case
      when b.status <> 'marcada' then null
      when b.joined_at is not null and b.joined_at > b.starts_at + make_interval(mins => s.late_after_minutes) then 'atraso'
      when b.joined_at is not null then 'presente'
      when now() >= b.starts_at + make_interval(mins => s.class_minutes) then 'sem-registro'
      else null
    end,
    b.meet_link, b.history
  from public.bookings b join public.profiles p on p.id = b.student_id
  where (p_student is null or b.student_id = p_student) and b.starts_at >= p_from
  order by b.starts_at desc;
end;
$$;

create or replace function public.set_attendance(p_id uuid, p_value text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_teacher() then raise exception 'Só o professor.' using errcode = '42501'; end if;
  if p_value is not null and p_value not in ('presente', 'atraso', 'falta', 'justificada') then raise exception 'Valor inválido.'; end if;
  update public.bookings set attendance = p_value, updated_at = now() where id = p_id;
end;
$$;

create or replace function public.set_class_link(p_id uuid, p_link text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_teacher() then raise exception 'Só o professor.' using errcode = '42501'; end if;
  update public.bookings set meet_link = nullif(trim(p_link), ''), updated_at = now() where id = p_id;
end;
$$;

-- What the student may see about themself: never the level or the AI limit.
create or replace function public.my_profile()
returns table (name text, goal text, interests text, classes_per_week int)
language sql stable security definer set search_path = '' as $$
  select p.name, s.goal, s.interests, s.classes_per_week
  from public.profiles p join public.student_settings s on s.student_id = p.id
  where p.id = auth.uid();
$$;

revoke all on function public.is_slot(timestamptz), public.week_count(uuid, timestamptz, uuid), public.check_bookable(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.available_slots(), public.book_class(timestamptz), public.cancel_class(uuid), public.reschedule_class(uuid, timestamptz),
  public.join_class(uuid), public.teacher_bookings(uuid, timestamptz), public.set_attendance(uuid, text), public.set_class_link(uuid, text), public.my_profile() from public, anon;
grant execute on function public.available_slots(), public.book_class(timestamptz), public.cancel_class(uuid), public.reschedule_class(uuid, timestamptz),
  public.join_class(uuid), public.teacher_bookings(uuid, timestamptz), public.set_attendance(uuid, text), public.set_class_link(uuid, text), public.my_profile() to authenticated;

-- Starting weekly slots (the teacher can change them in the panel).
insert into public.availability (weekday, start_time) values
  (1, '19:00'), (1, '19:30'), (2, '07:00'), (2, '12:30'), (3, '19:00'), (3, '19:30'), (3, '20:00'), (4, '19:00'), (4, '19:30'), (6, '09:00'), (6, '09:30'), (6, '10:00');
