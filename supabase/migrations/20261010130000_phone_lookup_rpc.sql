-- Phone-number lookups go through POST bodies, never URL query strings, so caller numbers
-- do not appear in API gateway access logs (brief §8: redact phone numbers in logs).

create or replace function public.find_recent_call(p_phone text, p_since timestamptz)
returns setof public.calls
language sql stable security definer set search_path = public as $$
  select * from public.calls
   where caller_phone_e164 = p_phone and started_at >= p_since
   order by started_at desc
   limit 1;
$$;

revoke execute on function public.find_recent_call(text, timestamptz) from public, anon, authenticated;
