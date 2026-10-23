-- FLUA: base schema.
-- Students only ever see their own data; the teacher sees everything.
-- Level, plan and AI limits live in student_settings, which students cannot read.
-- Conversation messages and AI usage are written only by the server (edge functions).

-- Profiles: one per login.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher')),
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

-- Teacher-only data about each student.
create table public.student_settings (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  level text not null default 'A2' check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  interests text not null default '',
  goal text not null default '',
  classes_per_week int not null default 2 check (classes_per_week between 1 and 7),
  daily_ai_limit_usd numeric(8, 4) not null default 0.10 check (daily_ai_limit_usd >= 0),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index conversations_student_idx on public.conversations (student_id, started_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) <= 4000),
  content jsonb,            -- assistant turns: every block returned by the API, sent back unchanged
  audio_path text,          -- user turns: the learner's real recording in the "audios" bucket
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  kind text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_student_day_idx on public.ai_usage (student_id, day);

-- Is the caller the teacher? security definer so policies can call it without recursion.
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;
revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

-- Every new login gets a profile. The school's teacher account becomes 'teacher'; everyone else is a student.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    case when lower(new.email) = 'marciellefarani@flua.onworkspace.com' then 'teacher' else 'student' end
  );
  insert into public.student_settings (student_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security
alter table public.profiles enable row level security;
alter table public.student_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_usage enable row level security;

create policy "profiles: read own or teacher" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_teacher());
create policy "profiles: teacher updates" on public.profiles
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "settings: teacher reads" on public.student_settings
  for select to authenticated using (public.is_teacher());
create policy "settings: teacher updates" on public.student_settings
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "conversations: read own or teacher" on public.conversations
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());

create policy "messages: read own or teacher" on public.messages
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());

create policy "ai_usage: teacher reads" on public.ai_usage
  for select to authenticated using (public.is_teacher());

-- Nobody but the server (service role) inserts conversations, messages or usage.
revoke insert, update, delete on public.conversations, public.messages, public.ai_usage from anon, authenticated;
revoke insert, delete on public.profiles, public.student_settings from anon, authenticated;
revoke all on public.profiles, public.student_settings, public.conversations, public.messages, public.ai_usage from anon;

-- Storage: private bucket for the learners' recordings, one folder per student.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audios', 'audios', false, 10485760, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
on conflict (id) do nothing;

create policy "audios: student uploads to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audios: read own or teacher" on storage.objects
  for select to authenticated
  using (bucket_id = 'audios' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));
