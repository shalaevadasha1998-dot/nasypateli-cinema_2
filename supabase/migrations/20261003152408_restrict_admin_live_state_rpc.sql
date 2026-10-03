revoke all on function public.app_admin_live_state(text) from public, anon, authenticated;
grant execute on function public.app_admin_live_state(text) to service_role;
