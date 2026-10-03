alter table public.event_rounds
drop constraint if exists event_rounds_question_target_check;

alter table public.event_rounds
add constraint event_rounds_question_target_check
check (question_target >= 0 and question_target <= 5);
