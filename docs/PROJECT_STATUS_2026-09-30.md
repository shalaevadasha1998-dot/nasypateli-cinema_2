# паспорт проекта и текущая готовность

обновлено: 2026-09-30

## продукт

- проект: «насыпатели в кино»
- repo: shalaevadasha1998-dot/nasypateli-cinema_2
- branch: main
- mini app: web/
- backend: supabase/functions/app/
- supabase project: vwteokawtqnoiyzmsldj
- bot: @nasipateli_v_kinobot
- production mini app: https://shalaevadasha1998-dot.github.io/nasypateli-cinema_2/

## событие 3 октября

- event id: 9d6866e8-1b9a-4fec-ac9a-a658d76cadc7
- slug: 2026-10-03
- status: SALES_OPEN
- starts_at: 2026-10-03 13:00 UTC / 16:00 Moscow
- capacity: 50
- ticket: 0 ₽
- venue: хлебозавод №9
- general venue address: Новодмитровская улица, 1, Москва
- exact internal room/building: not confirmed
- registrations checked 2026-09-30: 2 confirmed, 0 attended, 0 waitlist

## готовая техническая часть

- 3 movie candidates
- 3 ready film packages
- 15 film questions
- 3 ready video sources
- projector state exists
- show program exists
- runtime is idle before event
- closed projector route uses a screen token
- safe animal rehearsal mode exists and does not mutate production data
- animal projector uses anonymous stable screen ids
- public projector does not receive human identity mapping
- youtube and direct mp4/webm projector playback supported
- automatic source selection uses rights_status=allowed only
- manual source override can be used for a reviewed source with unknown rights
- dead/blocked source falls back through resolver
- film mission + 7 day review flow exists

## текущие visual assets

- rabbit-baby.png
- rabbit-head.png
- rabbit-idle.webp
- rabbit-name-react.webp
- birth-hatch.webp
- birth-sealed.webp
- birth-sealed-poster.webp

они позволяют провести событие, но projector creature art пока использует fallback-набор, а не пять специально нарисованных stage sprites.

см. docs/PROJECTOR_CREATURE_ASSETS.md.

## programme

active programme duration: 150 minutes.
current configured blocks:
- arrival 15m
- onboarding 5m
- warm_up 5m
- cinema_rounds_part_1 40m / 3 rounds
- music_live 30m
- cinema_rounds_part_2 45m / 4 rounds
- final_vote 5m
- finale 5m
- post_event

## важные открытые риски

### p0 before venue day

1. подтвердить точный внутренний зал / строение на хлебозаводе.
2. проверить реальный projector input, resolution, audio output и internet на площадке.
3. пройти настоящий telegram check-in одним тестовым участником и увидеть его animal на реальном projector.
4. прогнать все film package buttons на projector.
5. проверить громкость и autoplay youtube + direct video.
6. убедиться, что ведущий умеет открыть admin и получить новый screen link/check-in link.

### p1 content

1. финально проверить 18 границ видеофрагментов визуально, если нужна frame-perfect точность.
2. нарисовать 5 stage sprites по PROJECTOR_CREATURE_ASSETS.md.
3. при желании добавить event poses winner/think/review.
4. проверить rights evidence у любого нового источника до автоматического использования.

### p1 attendance

production на 2026-09-30 показывает 2 confirmed registrations при capacity 50.
capacity не означает целевую посещаемость, поэтому в этом документе не устанавливается выдуманная attendance target.
если фактическая цель выше 2 гостей, recruitment/outreach остаётся отдельным срочным потоком.

## source of truth

runtime/database важнее старых заметок и скриншотов.
публичные обещания, адрес, время, цена и количество мест должны сверяться с production перед публикацией.
