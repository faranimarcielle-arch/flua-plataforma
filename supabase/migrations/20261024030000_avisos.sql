-- Google Agenda + e-mails: each booking remembers what was last sent (to Google and by e-mail),
-- so the server function knows what changed: new class, moved class or cancelled class.

alter table public.bookings add column if not exists gcal_event_id text;
alter table public.bookings add column if not exists notified_status text;
alter table public.bookings add column if not exists notified_starts_at timestamptz;
alter table public.bookings add column if not exists sync_lock timestamptz;
alter table public.bookings add column if not exists sync_error text;

-- Classes that already happened or were cancelled before this change are not sent again.
update public.bookings set notified_status = status, notified_starts_at = starts_at
where notified_status is null and (status <> 'marcada' or starts_at < now());

-- Takes up to p_limit bookings with pending notices and locks them for 2 minutes,
-- so two calls at the same time never send the same e-mail twice. Server only.
create or replace function public.claim_booking_notices(p_limit int default 10)
returns table (id uuid, student_id uuid, starts_at timestamptz, status text, gcal_event_id text,
               notified_status text, notified_starts_at timestamptz, name text, email text)
language sql volatile security definer set search_path = '' as $$
  with c as (
    select b.id from public.bookings b
    where (b.notified_status is distinct from b.status or b.notified_starts_at is distinct from b.starts_at)
      and (b.sync_lock is null or b.sync_lock < now() - interval '2 minutes')
      and b.starts_at > now() - interval '1 day'
    order by b.updated_at
    limit p_limit
    for update skip locked
  ), u as (
    update public.bookings b set sync_lock = now() from c where b.id = c.id
    returning b.id, b.student_id, b.starts_at, b.status, b.gcal_event_id, b.notified_status, b.notified_starts_at
  )
  select u.id, u.student_id, u.starts_at, u.status, u.gcal_event_id, u.notified_status, u.notified_starts_at, p.name, p.email
  from u join public.profiles p on p.id = u.student_id;
$$;
revoke all on function public.claim_booking_notices(int) from public, anon, authenticated;
grant execute on function public.claim_booking_notices(int) to service_role;
