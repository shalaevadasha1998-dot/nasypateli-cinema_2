with target_events as (
  select id from public.events where slug in ('2026-10-03','test-2026-10-03')
),
rebuilt as (
  select
    ep.event_id,
    jsonb_agg(
      case
        when block->>'type' = 'music_live' then
          block || jsonb_build_object(
            'auto_advance', true,
            'audio_playlist', '[]'::jsonb,
            'audio_volume', 0
          )
        when coalesce((block->>'duration_min')::int,0) > 0 then
          block || jsonb_build_object('auto_advance', true)
        else block
      end
      order by ord
    ) as blocks
  from public.event_programs ep
  join target_events te on te.id=ep.event_id
  cross join lateral jsonb_array_elements(ep.config->'blocks') with ordinality as b(block,ord)
  group by ep.event_id
)
update public.event_programs ep
set config=jsonb_set(ep.config,'{blocks}',rebuilt.blocks,true),
    updated_at=now()
from rebuilt
where ep.event_id=rebuilt.event_id;

update public.event_runtime r
set block_started_at=now(),
    updated_at=now(),
    revision=revision+1
from public.events e
where e.id=r.event_id
  and e.slug='test-2026-10-03'
  and r.run_status='running'
  and r.current_block_id in ('cinema_rounds_part_1','cinema_rounds_part_2');
