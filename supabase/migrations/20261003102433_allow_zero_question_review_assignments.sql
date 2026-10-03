alter table public.film_assignments
  drop constraint if exists film_assignments_total_questions_check;

alter table public.film_assignments
  add constraint film_assignments_total_questions_check
  check (total_questions >= 0 and total_questions <= 5);
