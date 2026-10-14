-- All reads pass through Edge Function authorization. These SECURITY DEFINER
-- snapshots contain event/participant data and must not be public RPC endpoints.
revoke execute on function public.app_screen_live_state(text) from public, anon, authenticated;
revoke execute on function public.app_participant_live_state(text,uuid) from public, anon, authenticated;
grant execute on function public.app_screen_live_state(text) to service_role;
grant execute on function public.app_participant_live_state(text,uuid) to service_role;
