update public.creatures
set name=lower(trim(name))
where name is not null
  and name is distinct from lower(trim(name));
