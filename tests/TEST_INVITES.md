# Test evening invitations

`deno test --allow-env tests/test-invites.test.ts` checks guest-capability binding, malformed links, Telegram share encoding and existing event routing.

The integration report in `test-results/test-invites.json` was produced against an isolated local PostgreSQL 16 schema and the actual Deno API handler, using five synthetic Telegram sessions signed with a local-only bot token. It verifies identity separation, independent vote updates, denied admin access, denied live-event voting and no permanent crumb rewards. No real Telegram credentials or production participant writes were used.

The browser report uses the production frontend build at 320/390/430px, with a local API and simulated Telegram WebApp bridge. It checks the admin share button and ensures guest startup never requests the default/live event. Actual Telegram chat selection and sending remain a phone interaction.

Operator entry: https://t.me/nasipateli_v_kinobot?startapp=admin_test-2026-10-03

The operator must be an existing administrator. The guest capability is scoped to `test-2026-10-03` and only authorizes participation, not identity or administration. Missing Telegram/PWA identity fails closed. Existing legacy room keys remain usable for operators but are never included in the generated guest link. Test rooms cannot be restarted in live mode.
