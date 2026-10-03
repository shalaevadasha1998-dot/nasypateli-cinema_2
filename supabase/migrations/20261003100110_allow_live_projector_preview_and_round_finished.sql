alter table public.event_projector_state
  drop constraint if exists event_projector_state_state_check;

alter table public.event_projector_state
  add constraint event_projector_state_state_check
  check (state = any (array[
    'idle'::text,
    'arrival'::text,
    'pitch_collecting'::text,
    'pitch_locked'::text,
    'pitch_preview'::text,
    'pitch_randomizing'::text,
    'pitch_selected'::text,
    'movie_searching'::text,
    'movie_found'::text,
    'playing_clip'::text,
    'film_intro'::text,
    'one_word_collecting'::text,
    'one_word_results'::text,
    'question_open'::text,
    'question_results'::text,
    'question_reveal'::text,
    'assignment_randomizing'::text,
    'assignment_winner'::text,
    'round_finished'::text,
    'past_review_card'::text
  ]));
