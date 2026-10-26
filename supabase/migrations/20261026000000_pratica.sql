-- FLUA: reading, practice activities and the teacher's student file.
-- Students see and change only their own practice; the teacher sees everything.
-- Level stays teacher-only: the server function reads it, the student never does.

-- What the teacher sets per student: structures in focus and which activities are visible.
alter table public.student_settings add column if not exists focus text not null default '';
alter table public.student_settings add column if not exists visible_activities text[] not null
  default array['mission', 'detective', 'choice', 'voice', 'review', 'warmup'];

drop function if exists public.my_profile();
create function public.my_profile()
returns table (name text, goal text, interests text, classes_per_week int, classes_per_day int, visible_activities text[])
language sql stable security definer set search_path = '' as $$
  select p.name, s.goal, s.interests, s.classes_per_week, s.classes_per_day, s.visible_activities
  from public.profiles p join public.student_settings s on s.student_id = p.id
  where p.id = auth.uid();
$$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- Every finished attempt: how much support the learner needed (alone / with a hint / with a model).
create table if not exists public.practice_log (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  activity text not null check (char_length(activity) <= 60),
  focus text not null check (char_length(focus) <= 80),
  level text not null check (level in ('sozinho', 'pista', 'modelo')),
  created_at timestamptz not null default now()
);
create index if not exists practice_log_student_idx on public.practice_log (student_id, created_at desc);

-- Errors noticed in free practice (written by the server), used for "Dificuldades recorrentes".
create table if not exists public.practice_issues (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  activity text not null,
  focus text not null,
  original text not null,
  situation_pt text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists practice_issues_student_idx on public.practice_issues (student_id, created_at desc);

-- "De Volta": items that come back after 1, 3 or 7 days depending on the support needed.
create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  task_pt text not null check (char_length(task_pt) <= 400),
  goal text not null check (char_length(goal) <= 400),
  focus text not null check (char_length(focus) <= 80),
  hist text[] not null default '{}',
  due date not null default (now() at time zone 'America/Sao_Paulo')::date,
  source text not null default 'pratica' check (source in ('pratica', 'aula', 'professor')),
  note_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists review_items_student_idx on public.review_items (student_id, due);

-- Real-life challenges the learner accepted; the teacher marks them done or not done.
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 400),
  status text not null default 'pendente' check (status in ('pendente', 'feito', 'nao')),
  created_at timestamptz not null default now()
);

-- Reading texts written for each learner (by the server).
create table if not exists public.readings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  content jsonb not null,
  answers jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists readings_student_idx on public.readings (student_id, created_at desc);

-- Personalised situations for each activity (missions, cases, choices, voice messages), written by the server.
create table if not exists public.activity_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  activity text not null check (activity in ('mission', 'detective', 'choice', 'voice')),
  content jsonb not null,
  runs int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists activity_items_student_idx on public.activity_items (student_id, activity, created_at desc);

-- The teacher's file: notes, lesson plans, assessments, class logs, reports and decisions on difficulties.
create table if not exists public.teacher_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('observacao', 'planejamento', 'avaliacao', 'registro', 'relatorio', 'dificuldade')),
  note_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  body text not null default '' check (char_length(body) <= 10000),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists teacher_notes_student_idx on public.teacher_notes (student_id, kind, note_date desc);

-- Anonymous feedback: only the week is kept, never who wrote it or the exact time.
create table if not exists public.feedback_anon (
  id bigint generated always as identity primary key,
  week date not null,
  body text not null check (char_length(body) between 3 and 1500)
);

alter table public.practice_log enable row level security;
alter table public.practice_issues enable row level security;
alter table public.review_items enable row level security;
alter table public.challenges enable row level security;
alter table public.readings enable row level security;
alter table public.activity_items enable row level security;
alter table public.teacher_notes enable row level security;
alter table public.feedback_anon enable row level security;

drop policy if exists "practice_log: read own or teacher" on public.practice_log;
create policy "practice_log: read own or teacher" on public.practice_log for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "practice_issues: teacher reads" on public.practice_issues;
create policy "practice_issues: teacher reads" on public.practice_issues for select to authenticated using (public.is_teacher());
drop policy if exists "review_items: read own or teacher" on public.review_items;
create policy "review_items: read own or teacher" on public.review_items for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "review_items: teacher writes" on public.review_items;
create policy "review_items: teacher writes" on public.review_items for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "challenges: read own or teacher" on public.challenges;
create policy "challenges: read own or teacher" on public.challenges for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "challenges: student accepts" on public.challenges;
create policy "challenges: student accepts" on public.challenges for insert to authenticated with check (student_id = auth.uid() and status = 'pendente');
drop policy if exists "challenges: teacher updates" on public.challenges;
create policy "challenges: teacher updates" on public.challenges for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "readings: read own or teacher" on public.readings;
create policy "readings: read own or teacher" on public.readings for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "activity_items: read own or teacher" on public.activity_items;
create policy "activity_items: read own or teacher" on public.activity_items for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "teacher_notes: teacher only" on public.teacher_notes;
create policy "teacher_notes: teacher only" on public.teacher_notes for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "feedback_anon: teacher reads" on public.feedback_anon;
create policy "feedback_anon: teacher reads" on public.feedback_anon for select to authenticated using (public.is_teacher());

revoke all on public.practice_log, public.practice_issues, public.review_items, public.challenges, public.readings,
  public.activity_items, public.teacher_notes, public.feedback_anon from anon;
revoke insert, update, delete on public.practice_log, public.practice_issues, public.readings, public.activity_items, public.feedback_anon from authenticated;
revoke update, delete on public.challenges from authenticated;
grant update (status) on public.challenges to authenticated;  -- the policy limits it to the teacher

-- Student actions go through these functions, which check ownership and keep values in range.
create or replace function public.log_practice(p_activity text, p_focus text, p_level text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  insert into public.practice_log (student_id, activity, focus, level)
  values (auth.uid(), left(coalesce(p_activity, ''), 60), left(coalesce(nullif(trim(p_focus), ''), 'Outro'), 80), p_level);
end;
$$;

-- New "De Volta" item, back tomorrow.
create or replace function public.queue_review(p_task text, p_goal text, p_focus text, p_level text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if (select count(*) from public.review_items where student_id = auth.uid()) >= 300 then return; end if;
  insert into public.review_items (student_id, task_pt, goal, focus, hist, due)
  values (auth.uid(), left(p_task, 400), left(coalesce(nullif(p_goal, ''), 'communicate the situation'), 400),
          left(coalesce(nullif(trim(p_focus), ''), 'Outro'), 80), array[p_level], (now() at time zone 'America/Sao_Paulo')::date + 1);
end;
$$;

-- A "De Volta" item was practised: alone twice in a row = back in 7 days, alone = 3 days, with help = tomorrow.
create or replace function public.review_done(p_id uuid, p_level text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.review_items; prev text;
begin
  select * into r from public.review_items where id = p_id and student_id = auth.uid() for update;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0001'; end if;
  if p_level not in ('sozinho', 'pista', 'modelo') then raise exception 'Nível inválido.' using errcode = 'P0001'; end if;
  prev := r.hist[array_length(r.hist, 1)];
  update public.review_items set hist = (hist || p_level)[greatest(1, array_length(hist, 1) - 18):],
    due = (now() at time zone 'America/Sao_Paulo')::date + case when p_level <> 'sozinho' then 1 when prev = 'sozinho' then 7 else 3 end
  where id = p_id;
end;
$$;

create or replace function public.answer_reading(p_id uuid, p_question int, p_choice int)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_question not between 0 and 9 or p_choice not between 0 and 5 then raise exception 'Resposta inválida.' using errcode = 'P0001'; end if;
  update public.readings set answers = answers || jsonb_build_object(p_question::text, p_choice)
  where id = p_id and student_id = auth.uid() and not answers ? p_question::text;
end;
$$;

create or replace function public.bump_activity_run(p_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.activity_items set runs = runs + 1 where id = p_id and student_id = auth.uid();
$$;

create or replace function public.send_feedback(p_body text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 3 then raise exception 'Escreva sua mensagem antes de enviar.' using errcode = 'P0001'; end if;
  insert into public.feedback_anon (week, body)
  values (date_trunc('week', now() at time zone 'America/Sao_Paulo')::date, left(trim(p_body), 1500));
end;
$$;

revoke all on function public.log_practice(text, text, text), public.queue_review(text, text, text, text), public.review_done(uuid, text),
  public.answer_reading(uuid, int, int), public.bump_activity_run(uuid), public.send_feedback(text) from public, anon;
grant execute on function public.log_practice(text, text, text), public.queue_review(text, text, text, text), public.review_done(uuid, text),
  public.answer_reading(uuid, int, int), public.bump_activity_run(uuid), public.send_feedback(text) to authenticated;
