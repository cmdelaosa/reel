-- 0014_invite_rpcs.sql
-- Invite management RPCs: create (capped at 10 unused per user, 30-day expiry)
-- and list-mine (with the redeemer's handle — needs security definer since
-- profiles SELECT is owner-only until Phase 4).

create function public.rpc_create_invite()
returns public.invites
language plpgsql
security invoker
as $$
declare
  v_row public.invites;
begin
  if (select count(*) from public.invites
        where created_by = auth.uid() and used_by is null) >= 10 then
    raise exception 'You can have at most 10 unused invites at a time.'
      using errcode = 'P0003';
  end if;
  -- readable, unlikely to collide; retry once on the off chance
  for i in 1..3 loop
    begin
      insert into public.invites (code, created_by, expires_at)
      values ('REEL-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
              auth.uid(), now() + interval '30 days')
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- try again with a fresh code
    end;
  end loop;
  raise exception 'could not allocate an invite code, try again';
end;
$$;

grant execute on function public.rpc_create_invite() to authenticated;

create function public.rpc_my_invites()
returns table (
  code text,
  status text,
  used_by_handle text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    i.code,
    case
      when i.used_by is not null then 'used'
      when i.expires_at is not null and i.expires_at < now() then 'expired'
      else 'unused'
    end,
    p.handle::text,
    i.expires_at,
    i.created_at
  from public.invites i
  left join public.profiles p on p.id = i.used_by
  where i.created_by = auth.uid()
  order by i.created_at desc
$$;

grant execute on function public.rpc_my_invites() to authenticated;
