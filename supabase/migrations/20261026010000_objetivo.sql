-- The communicative goal guides the AI; the student only sees it when the teacher chooses to show it.
alter table public.student_settings add column if not exists show_goal boolean not null default false;

drop function if exists public.my_profile();
create function public.my_profile()
returns table (name text, goal text, interests text, classes_per_week int, classes_per_day int, visible_activities text[])
language sql stable security definer set search_path = '' as $$
  select p.name, case when s.show_goal then s.goal else '' end, s.interests, s.classes_per_week, s.classes_per_day, s.visible_activities
  from public.profiles p join public.student_settings s on s.student_id = p.id
  where p.id = auth.uid();
$$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
