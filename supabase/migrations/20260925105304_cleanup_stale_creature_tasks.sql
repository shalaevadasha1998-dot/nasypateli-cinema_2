-- Remove creature-task state that could only have been left by the
-- pre-fix profile deletion flow. Legitimate task completion requires a born creature.

delete from public.user_creature_tasks uct
using public.creatures c
where c.user_id=uct.user_id
  and c.born_at is null;
