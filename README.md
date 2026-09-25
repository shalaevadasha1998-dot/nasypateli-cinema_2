# НАСЫПАТЕЛИ В КИНО — технический источник истины

Рабочая ветка: `main`.

## Что является продуктом
- Mini App: `web/`
- серверная функция: `supabase/functions/app/`
- проект Supabase: `vwteokawtqnoiyzmsldj`
- Telegram-бот: `@nasipateli_v_kinobot`
- пилот: `2026-10-03`, 30 мест, 500 ₽

ZIP-снимки версий не являются исходным кодом и не должны возвращаться в репозиторий.

## Выпуск
- Mini App: `.github/workflows/pages.yml` → GitHub Pages
- сервер: `.github/workflows/supabase-functions.yml` → Supabase Edge Function `app`
- обязательная проверка: `.github/workflows/blank.yml`
- проверка безопасности: `.github/workflows/codeql.yml`
- доставка уведомлений: `.github/workflows/notifications.yml` каждые 10 минут
- контроль production: `.github/workflows/production-health.yml` каждый час

Статус готовности определяется рабочим окружением, а не только успешной сборкой. Отложенная настройка платежей отображается как warning и не скрывает реальные ошибки core-системы.

## Секреты
Значения секретов в репозитории не хранятся. Рабочее окружение ожидает только имена, перечисленные в `supabase/functions/.env.example`.

## База данных
Файлы `supabase/PATCH_*.sql` и `supabase/SETUP_THIS_PROJECT.sql` — исторические ручные патчи. Они не являются конкурирующим способом выпуска и автоматически не запускаются.
Фактическое состояние рабочей базы проверяет серверная готовность. Новые изменения схемы должны оформляться как отдельные миграции, а не новым набором `PATCH_FINAL_v2.sql`.
