begin;

grant usage on schema public to service_role;

revoke all on public.events, public.community_reports, public.device_events,
  public.report_upload_tickets, public.api_rate_limits from service_role;
grant select, insert, delete on public.events to service_role;
grant select, insert on public.community_reports, public.device_events to service_role;
grant select, insert, update, delete on public.report_upload_tickets to service_role;
grant select on public.api_rate_limits to service_role;

revoke all on sequence public.events_id_seq from service_role;
grant usage on sequence public.events_id_seq to service_role;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

commit;
