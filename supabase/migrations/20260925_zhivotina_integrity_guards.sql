-- Zhivotina v1 integrity guards.
-- Existing production data was checked before this migration:
-- growth is non-negative and the default stage thresholds are ordered.

alter table public.creatures
  drop constraint if exists creatures_growth_progress_check;

alter table public.creatures
  add constraint creatures_growth_progress_check
  check (growth_progress >= 0);

alter table public.user_creature_tasks
  drop constraint if exists user_creature_tasks_creature_fkey;

alter table public.user_creature_tasks
  add constraint user_creature_tasks_creature_fkey
  foreign key (user_id)
  references public.creatures(user_id)
  on delete cascade;

alter table public.creature_game_config
  drop constraint if exists creature_game_config_stage_thresholds_check;

alter table public.creature_game_config
  add constraint creature_game_config_stage_thresholds_check
  check (
    jsonb_typeof(stage_thresholds) = 'object'
    and stage_thresholds ?& array['stage_0','stage_1','stage_2','stage_3','stage_4']
    and (stage_thresholds->>'stage_0')::integer = 0
    and (stage_thresholds->>'stage_1')::integer > (stage_thresholds->>'stage_0')::integer
    and (stage_thresholds->>'stage_2')::integer > (stage_thresholds->>'stage_1')::integer
    and (stage_thresholds->>'stage_3')::integer > (stage_thresholds->>'stage_2')::integer
    and (stage_thresholds->>'stage_4')::integer > (stage_thresholds->>'stage_3')::integer
  );
