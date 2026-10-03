alter table public.event_rounds
  drop constraint if exists event_rounds_flow_status_check;

alter table public.event_rounds
  add constraint event_rounds_flow_status_check
  check (flow_status = any (array[
    'draft'::text,
    'collecting_films'::text,
    'films_locked'::text,
    'randomizing_submission'::text,
    'submission_selected'::text,
    'searching_movie'::text,
    'movie_found'::text,
    'playing_clip'::text,
    'one_word_collecting'::text,
    'one_word_results'::text,
    'generating_question'::text,
    'question_open'::text,
    'question_results'::text,
    'question_reveal'::text,
    'next_question'::text,
    'assignment_randomizing'::text,
    'assignment_selected'::text,
    'round_finished'::text
  ]));
