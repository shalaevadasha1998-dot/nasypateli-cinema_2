insert into events (slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,status,settings)
values ('2026-10-03','НАСЫПАТЕЛИ В КИНО — 3 октября','2026-10-03 18:00:00+03',30,500,150,'SALES_OPEN',jsonb_build_object('city','Москва'))
on conflict (slug) do update set
  title=excluded.title,
  starts_at=excluded.starts_at,
  capacity=excluded.capacity,
  ticket_price_rub=excluded.ticket_price_rub,
  max_movie_runtime_min=excluded.max_movie_runtime_min,
  settings=(coalesce(events.settings,'{}'::jsonb) - 'format') || jsonb_build_object('city','Москва');
