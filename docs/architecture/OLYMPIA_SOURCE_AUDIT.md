# Olympia extraction — Source audit and dependency inventory

**Status:** completed static audit of the provided `edu-sync.zip`; no source files were modified and no tests/build/database commands were run.  
**Source baseline:** committed snapshot represented by `main` / `feature/luan/olympia` at `73afbdc` (confirmed by the user). Local `public/service-worker.js` change is intentionally out of scope.  
**Working copy on user's PC:** `D:\app\olympia`, exported without `.git` from committed `main`.

## 1. Scope verified in the ZIP

| Area | Files | Notes |
|---|---:|---|
| `app/(olympia)/olympia/` | 50 | 20 `page.tsx` route pages plus layouts, loading/error and route-specific files |
| `app/api/olympia/` | 5 | API handlers |
| `actions/olympia/` | 4 | match, permissions, realtime and scoring action modules |
| `components/olympia/` | 71 | core Olympia components; one non-code/config file included |
| `lib/olympia/` | 15 | auth helper, config, workbook parser, realtime guard, sound system and JSON configuration |
| `types/olympia/` | 2 | Olympia-specific types |

The route tree is already logically segmented by Next.js route groups `(olympia)`, `(admin)` and `(client)`. Preserve the public URL paths during the first extraction; avoid combining a URL redesign with the auth/database refactor.

### Current pages

- `/olympia`
- `/olympia/admin`
- `/olympia/admin/accounts`
- `/olympia/admin/matches`
- `/olympia/admin/matches/[matchId]`
- `/olympia/admin/matches/[matchId]/host`
- `/olympia/admin/question-bank`
- `/olympia/admin/rooms`
- `/olympia/client`
- `/olympia/client/admin/[joinCode]`
- `/olympia/client/game/[joinCode]`
- `/olympia/client/guest/[joinCode]`
- `/olympia/client/how-to-join`
- `/olympia/client/join`
- `/olympia/client/matches`
- `/olympia/client/mc/[joinCode]`
- `/olympia/client/watch`
- `/olympia/client/watch/[joinCode]`
- `/olympia/mc`
- `/olympia/mc/[joinCode]`

### API route handlers

- `app/api/olympia/host/snapshot/route.ts`
- `app/api/olympia/match-players-remove/route.ts`
- `app/api/olympia/match-players/route.ts`
- `app/api/olympia/reset-ve-dich-packages/route.ts`
- `app/api/olympia/verify-mc-password/route.ts`

## 2. Non-Olympia dependencies that must be copied, replaced, or removed deliberately

### Keep or create minimal replacements

- `app/globals.css` — current shared styling base.
- `components/ui/` — the reusable UI primitives referenced by Olympia (buttons, dialogs, cards, tables, sidebar, toast, etc.). Copy only what the import graph requires, or keep this folder intact for the first migration pass to avoid deleting a transitive UI dependency.
- `components.json` — shadcn/ui configuration if the current UI primitives are retained.
- `utils/cn.ts` and/or `lib/utils.ts` — keep the exact helpers referenced by the module; remove duplicate only after confirming imports.
- `configs/env.ts` — currently used by `lib/supabase.ts` for public Supabase environment parsing.
- `lib/supabase.ts`, `lib/supabase-server.ts`, `lib/supabase-admin-server.ts` — replace with one coherent SSR/browser/admin-client implementation, not copy unchanged.
- `hooks/useOnlineStatus.ts` — used by `OlympiaGameClient`; keep if the hook remains referenced.
- `lib/link-optimizer.ts` — used by Olympia admin sidebar; keep or remove the reference.
- Root CSS, TypeScript alias (`@/*`), Next image config for Supabase-hosted media, ExcelJS and related packages for question-set import.

### Replace/remove EduSync-specific shell

- `app/page.tsx` currently depends on `getServerAuthContext`, `getServerRoles`, and `summarizeRoles`, then redirects to `/admin` or `/client`. Replace with a simple Olympia-aware redirect, e.g. `/login` or `/olympia` based on the new auth contract.
- `app/layout.tsx` brands the app as EduSync and imports `components/common/OfflineIndicator`, `ServiceWorkerRegistration` and `ClientAppVersionBadge`. Either remove these EduSync-specific items or consciously retain/rebrand the PWA functionality; do not carry them accidentally.
- `proxy.ts` contains legacy cookie parsing, EduSync redirects/roles, and host-specific Olympia redirection. Rewrite it as a narrow Next.js 16 proxy for Supabase SSR token refresh and route redirects only. Authorization belongs in server helpers/Route Handlers/Server Actions, not a hand-decoded JWT in the proxy.
- `app/login/page.tsx` and `components/login/*` are the EduSync login. Reuse only visual pieces after review; implement Olympia-specific sign-in and sign-out behavior with Supabase SSR.
- `components/admin/layout/AdminHeader` and `AdminMainContent` are used by the Olympia admin layout. Prefer a small Olympia-owned header/content wrapper; keep generic sidebar primitives under `components/ui/sidebar`.
- Do not import general EduSync admin/client routes or the `public` school/violation domain.

### Project config to rebrand

- `package.json` package name currently `edu-sync`; use a safe package name such as `olympia-app`.
- `supabase/config.toml` has `project_id = "edu-sync"`; rename the local project to `olympia` and review `seed.sql` config (the ZIP listing should be checked; do not point at an EduSync seed).
- `next.config.ts` depends on `configs/generated/version.json` and `scripts/inject-version.cjs` for EduSync version injection. Remove or simplify this if the Olympia app does not need the version badge. Preserve the 20 MB Server Action upload limit for XLSX/media manifest only if still required.
- The archive omitted `.env.local.example` because it was not part of the committed snapshot, even though the ZIP contains it. Recreate a new safe `.env.local.example`; never copy `.env.local`.
- Avoid retaining EduSync-only scripts, generated logs/reports, `pnpm-workspace.yaml` if not needed, and duplicate lockfiles without a deliberate package-manager decision. The repo currently has both `package-lock.json` and `pnpm-lock.yaml`, and `package.json` uses pnpm in scripts/docs; choose one package manager (recommend pnpm) and keep only its lockfile after dependency validation.

## 3. Direct identity dependencies found in Olympia code

These are first-pass high-priority call sites found by static search. They are not the only files that require modification; helper imports and relationship joins must also be followed during implementation.

| File | Legacy dependency | Required change |
|---|---|---|
| `lib/server-auth.ts` | manual token payload decoding; `public.users`, `public.user_roles`, `public.permissions` | replace with Supabase SSR `auth.getUser()` and Olympia-only role checks; remove `appUserId` mapping |
| `lib/olympia/olympia-auth.ts` | admin is `participants.role === 'AD'` | check `olympia.user_roles` / trusted server policy; use canonical Auth UID |
| `lib/olympia-access.ts` | participant role mixes AD/MC/player semantics | separate system admin, participant membership, and session-scoped MC access |
| `actions/olympia/permissions.actions.ts` | `.from('users')`, `session_verifications`, missing `session_password_history`, plaintext password history; non-cryptographic join code | use session access grants, server-validated credentials, rate limits, CSPRNG join code and secure password handling |
| `actions/olympia/match.actions.ts` | `.from('users')` in participant management; roles `contestant/AD/MOD` | provision account/participant via server admin action, eliminate EduSync role mapping |
| `app/(olympia)/olympia/(admin)/admin/accounts/page.tsx` | `users`, `user_profiles`, `classes` queries | list Olympia profiles and participants from new schema; stop listing school classes |
| `app/(olympia)/olympia/(admin)/admin/matches/[matchId]/page.tsx` | `users`, attempted `auth.users`, `user_profiles`, `session_password_history` | query Olympia profiles, not Auth schema via Data API; replace session-password retrieval |
| `app/api/olympia/match-players/route.ts` | user/profile joins | return safe names from Olympia profiles and enforce host/admin access |
| `app/(olympia)/olympia/(client)/client/game/[joinCode]/page.tsx` | `session_verifications`; round question query returns answer fields | validate session grant on server and return a safe public game projection only |
| `app/(olympia)/olympia/(client)/client/mc/[joinCode]/page.tsx` | loads question/answer records before client-side password gate | verify MC access on server before returning any answer key or private notes |
| `app/(olympia)/olympia/(client)/client/guest/[joinCode]/page.tsx` | can load answer-bearing round question joins | return only public fields; no answer key before host reveal |
| `app/(olympia)/olympia/(client)/client/watch/[joinCode]/page.tsx` and `watch/page.tsx` | similar round-question joins | verify audience contract and never send private answer fields to guest/browser |
| `app/api/olympia/verify-mc-password/route.ts` | likely shares MC password pathway | issue a short-lived, revocable server-verified session grant; no client-only unlocked flag as authorization |
| `components/olympia/admin/accounts/CreateParticipantDialog.tsx` | `user_profiles` response shape | switch to Olympia profile fields, retain contestant registration semantics |
| `app/(olympia)/olympia/(admin)/admin/layout.tsx` | EduSync auth helper and shared admin header/content | use Olympia auth guard and Olympia-owned shell |

Other routes, actions and components importing `@/lib/server-auth` must be migrated together; do not leave a compatibility shim that queries `public.users` just to make TypeScript compile.

## 3.1. Direct database query concentration (static occurrence counts)

Counts below are occurrences of `.from("table")` / `.from('table')` within Olympia-owned TS/TSX source, not unique rows or query executions. They help prioritize migrations; nested relation selects and Realtime subscriptions are additional dependencies.

| Table | Query occurrences | Files | Priority / note |
|---|---:|---:|---|
| `live_sessions` | 83 | 19 | Highest; room state and password/session workflows |
| `round_questions` | 52 | 13 | High; answer-bearing snapshots and question joins |
| `answers` | 39 | 9 | High; submitted answers, decisions and score flow |
| `buzzer_events` | 26 | 10 | High; timing and winner state |
| `match_players` | 24 | 13 | High; contestant slots and display identity |
| `matches` | 23 | 15 | High; tournament/match control |
| `match_scores` | 20 | 7 | High; scoreboard snapshot |
| `star_uses` | 13 | 7 | Medium-high; Về đích star state |
| `match_rounds` | 11 | 6 | High; round configuration/state |
| `participants` | 10 | 5 | High; needs new account-membership contract |
| `question_set_items` | 10 | 4 | High; new canonical question bank |
| `question_sets` | 8 | 4 | Medium-high; imports and assignment |
| `score_changes` | 6 | 2 | High; audit/undo integrity |
| `users` | 6 | 4 | Remove all EduSync queries |
| `session_password_history` | 5 | 2 | Replace: missing migration and plaintext history |
| `tournaments` | 5 | 3 | Medium |
| `match_question_sets` | 4 | 3 | Medium |
| `auth.users` | 2 | 1 | Invalid as a normal PostgREST table query; use Auth Admin API/server-side profile data |
| `session_verifications` | 2 | 2 | Replace with short-lived session grants |
| `user_profiles` | 2 | 1 | Replace with Olympia profiles |
| `classes` | 1 | 1 | Remove from Olympia screens |
| `obstacle_guesses` | 1 | 1 | Keep initially; Host still reads it |
| `obstacle_tiles` | 1 | 1 | Keep |
| `obstacles` | 1 | 1 | Keep |
| `realtime_events` | 1 | 1 | Insert count only; listeners use `postgres_changes` and are listed in Section 6 |

## 4. Questions and round snapshot call sites

The `questions` table isn't directly selected with `.from('questions')` in the main game path, but is selected by nested PostgREST relationship joins in these important locations:

- `components/olympia/shared/game/useOlympiaGameState.ts` lines around 344, 428 and 512.
- `app/(olympia)/olympia/(client)/client/game/[joinCode]/page.tsx` around 92.
- `app/(olympia)/olympia/(client)/client/mc/[joinCode]/page.tsx` around 61.
- `app/(olympia)/olympia/(client)/client/guest/[joinCode]/page.tsx` around 73.
- `app/(olympia)/olympia/(client)/client/watch/page.tsx` around 79.
- `app/(olympia)/olympia/(admin)/admin/matches/[matchId]/host/server/round-questions-cache.ts` around 26.
- `components/olympia/admin/matches/HostQuestionPreviewCard.tsx` reads the `question_set_items` relation.

The seed script and game types may also reference the old question shape. Before dropping `questions`/`round_questions.question_id`, update nested selects, row types, cache keys and fallback resolution together. Use `question_set_items` for the editable question bank and a snapshot on `round_questions` for the configured match. The snapshot must preserve content/media as chosen at match setup so editing the source bank later cannot mutate a configured or running match.

## 5. `obstacle_guesses` source-of-truth decision

- `app/(olympia)/olympia/(admin)/matches/[matchId]/host/server/fetch-host-data.ts` reads `obstacle_guesses`.
- `actions/olympia/scoring.actions.ts` has comments saying some guess submission/confirmation flows no longer use `obstacle_guesses` and instead record through `answers`.

Keep `obstacle_guesses` initially in the new schema to avoid silently breaking Host history. As part of the refactor, make it the single canonical store for final-keyword guesses; do not duplicate a guess in both `answers` and `obstacle_guesses`. `answers` remains the canonical response store for round-question submissions. Only remove the table after the Host query and all write/read paths have been intentionally migrated and checked.

## 6. Realtime security finding — critical

Migration `20260103093500_grant_public_read_olympia.sql` grants `SELECT` to `anon` and `authenticated` on `live_sessions`, `round_questions`, `answers`, `obstacles`, `obstacle_tiles`, `buzzer_events`, etc. Migration `20260114090000_add_olympia_realtime_events.sql` grants broad `SELECT` to `realtime_events` and its answer trigger puts `answerText` and `isCorrect` into every inserted event. Current listeners include:

- `components/olympia/shared/game/useOlympiaGameState.ts`
- `components/olympia/shared/game/AnswersOverlay.tsx`
- `components/olympia/admin/matches/LiveScoreboard.tsx`
- `components/olympia/admin/matches/HostAutoSync.tsx`
- `components/olympia/admin/matches/HostAnswersByTimeCard.tsx`
- `components/olympia/admin/matches/HostLiveAnswersCard.tsx`
- `components/olympia/admin/matches/HostRealtimeEventsListener.tsx`
- `components/olympia/client/client/LiveScheduleRealtime.tsx`

Do not simply carry over the grant or raw trigger payload. Public stream must be whitelisted and safe. Host/MC answer/notes require a separately authorized server path or private event stream. Guest/player must not receive answer key, correctness, private notes or credentials in HTML/server props/network/realtime before Host reveals the answer. Keep existing realtime event names where possible, but change payload projection where required for privacy.

## 7. Other verified inconsistencies to resolve in the fresh schema

1. The original `question_set_items.question_id NOT NULL` requirement was later made nullable; new schema should not include the legacy column if no current workflow requires it.
2. Migration origin for `answers` doesn't match the runtime fields (`match_round_id`, `response_time_ms`, `submitted_at`). New baseline must match the actual app's read/write contract.
3. `session_password_history` is referenced by runtime but no corresponding create-table migration appears in the 21-file migration set included in the ZIP. Don't keep this broken historical approach.
4. Migration restricts `buzzer_events.event_type` to `buzz`/`steal`, but runtime writes `reset`. Include all supported values and decide a controlled enum/check.
5. `participants.role` permits only `AD` or NULL in the old schema, while some UI/actions offer `MOD` and access helper has an `MC` branch. Split system roles from player membership and MC session grants.
6. `matches.code` exists in an old URL verification document but current route contracts use `matches.id` and `live_sessions.join_code`; omit it from baseline unless product requirements change.
7. Current MC gate is client-side and occurs after data load in some routes; the server must gate before returning private data.
8. Scoreboard updates and `score_changes` audit are multiple client/server DB operations; score mutation + audit should ultimately use one server-owned Postgres RPC/transaction.
9. Session passwords are short (6 hex chars), SHA-256 hash is stored in columns named `player_password`/`mc_view_password`, and plaintext is stored in the legacy history table. Increase password entropy, rate-limit verifications, and keep only hash + (if re-view capability is retained) authenticated encryption for the current password.
10. `generateJoinCode()` uses `Math.random()`. Replace with `crypto.randomBytes`/`randomInt` plus unique-collision retry.

## 8. Recommended implementation order

1. Establish project identity/config and preserve the route tree; do not delete code until import map is known.
2. Create the clean database baseline, schema/RLS/Storage/event contract, and typed DB boundary.
3. Replace auth helpers and create the first-admin bootstrap/account provisioner.
4. Refactor admin account/participant pages and all users/user_profiles/classes/roles call sites.
5. Refactor question bank and round-question snapshot call sites, removing the dual `questions` join.
6. Refactor session verification and MC flow; verify auth on server before returning secrets.
7. Refactor public/private Realtime projections and API snapshot payloads.
8. Move score and buzzer critical operations behind atomic server RPCs after matching current scoring behavior.
9. Remove the EduSync route groups, scripts, components and metadata not imported by Olympia; retain transitive UI primitives.
10. Perform focused checks, then initialize the new Git repo and make the first commit. Do not add a remote or push until the owner has created/chosen a separate Olympia GitHub repository.

## 9. Local/repository facts from user confirmation

- `main` and `feature/luan/olympia` both resolve to `73afbdc`.
- `git status --short` in `D:\app\edu-sync` reports only `M public/service-worker.js`; the owner says this is only an app-version edit and should be ignored, not committed.
- `D:\app\olympia` intentionally has no `.git` because it was exported with `git archive`; therefore `git status` failing there is expected until the new repo is initialized.
- Never copy `.env.local` from EduSync. Recreate `.env.local.example` with empty values only. The uploaded ZIP contains a `.env.local`; do not echo or replicate its secret values. If its keys are real and this file left the owner's trusted environment, rotate the keys.

## 10. Out of scope for the extraction

- School/classes/grades/criteria/records/complaints/notifications/violation modules.
- Old user, participant, tournament, match, score or audit data. No data migration is required.
- Preserving EduSync's Git history, branches or remote in the Olympia repository.
- Unrequested redesign of the game UI/rules. Preserve documented game behavior unless a source inconsistency requires an explicit choice.
