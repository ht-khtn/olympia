# Olympia độc lập — kế hoạch thi hành cho VS Code agent

Tài liệu này là hợp đồng triển khai. ChatGPT/chủ dự án quyết định kiến trúc; agent chỉ thực hiện phạm vi của từng giai đoạn, không tự thiết kế lại sản phẩm.

## Quy tắc chung cho mọi giai đoạn

- Chỉ làm việc trong `D:\app\olympia`, không sửa `D:\app\edu-sync`.
- Workspace mới cố ý chưa có `.git`; không khởi tạo Git trước Giai đoạn 8.
- Không sao chép `.env.local`, không in/đọc giá trị bí mật ra output, không commit secret.
- Bảo toàn tính năng Olympia và luật bốn vòng; chỉ thay đổi hành vi khi tài liệu này yêu cầu vì gỡ phụ thuộc EduSync hoặc bảo mật.
- Không tự ý làm mới UI, refactor ngoài phạm vi, xóa thư mục khi chưa kiểm tra import.
- Không chạy toàn bộ test/lint/build mặc định. Chỉ chạy kiểm tra cần thiết cho giai đoạn đang làm và ghi rõ kết quả.
- Không chạy migration lên Supabase remote, không deploy, không push, không `git reset --hard`, `git clean` hoặc lệnh phá hủy dữ liệu.
- Không để service-role key trong client bundle. Không coi JWT tự decode, cookie tự đặt hoặc cờ React `unlocked` là bằng chứng cấp quyền.
- Mỗi giai đoạn chỉ đọc các file được nêu và import trực tiếp cần thiết; không quét toàn repo vô mục đích.
- Cuối giai đoạn báo: file đổi, quyết định đã thi hành, check đã chạy/chưa chạy, blocker cụ thể. Không tự động nhảy sang giai đoạn kế tiếp.

---

## Giai đoạn 1 — Chuẩn hóa danh tính dự án, chưa xóa code

Dùng prompt riêng trong `docs/architecture/OLYMPIA_PHASE1_PROMPT.txt`.

## Giai đoạn 2 — Tạo baseline database sạch

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Đọc `docs/architecture/OLYMPIA_SCHEMA_TARGET_DESIGN.md`, `docs/architecture/OLYMPIA_SOURCE_AUDIT.md`, `actions/olympia/match.actions.ts`, `actions/olympia/permissions.actions.ts`, `actions/olympia/realtime.actions.ts`, `actions/olympia/scoring.actions.ts`, `types/olympia/game.ts`, `app/(olympia)/olympia/(admin)/matches/[matchId]/host/server/types.ts` và các migration cũ liên quan để tham khảo. Migration cũ không phải schema để chạy lại nguyên xi.
>
> Tạo lịch sử migration mới có thể khởi tạo từ database Supabase trống. Vì không cần dữ liệu cũ, thay chuỗi migration legacy trong repo mới bằng baseline sạch và các migration có thứ tự. Tuyệt đối không chạy lên remote database.
>
> Yêu cầu: schema `olympia`; ID tài khoản chuẩn là `auth.users.id` phản chiếu qua `olympia.profiles.id`; không có FK/query tới bảng EduSync `public.users`. Tách `user_roles` (quản trị hệ thống) khỏi `participants` (tư cách thi đấu). Không dùng MC/Guest làm global role.
>
> Giữ các bảng/quan hệ nghiệp vụ được mô tả trong schema design: tournament, match, match players, rounds, question sets/items, round question snapshots, live session, answers, scores, score changes, buzzer, star, obstacles/tiles/guesses, realtime. Nguồn ngân hàng là `question_set_items`; bỏ cột `round_questions.question_id` và bảng legacy `questions` sau khi design/call-site đối chiếu. Snapshot câu hỏi trận phải giữ nội dung, đáp án, note và media đã chọn.
>
> Schema mới phải tương thích query runtime cần giữ (`answers.match_round_id`, `response_time_ms`, `submitted_at`, v.v.) và cho phép event `buzzer_events.event_type='reset'`. Giữ `obstacle_guesses` vì Host fetch vẫn đọc nó; nó là nguồn duy nhất cho lần đoán từ khóa CNV, còn `answers` là nguồn trả lời câu hỏi trong vòng.
>
> Thay `session_verifications` bằng `session_access_grants` theo thiết kế. Không tạo bảng lịch sử lưu mật khẩu plaintext. Nếu giữ khả năng admin xem lại mật khẩu phòng hiện tại, chỉ lưu hash và ciphertext hiện tại; encryption key chỉ nằm ở server. Không bắt buộc giữ lịch sử plaintext.
>
> Bật RLS cho bảng expose; GRANT tối thiểu. Không sao chép migration cấp `SELECT` rộng cho `anon`. Dữ liệu/event công khai tuyệt đối không gồm `answerText`, kết quả đúng/sai trước khi Host công bố, private note, hash/ciphertext mật khẩu hoặc token. Không tạo trigger realtime cũ với payload nguyên xi.
>
> Thêm ghi chú cho từng bảng: mục đích, PK/FK, RLS dự kiến và thứ tự migration. Không sửa call site ứng dụng trong giai đoạn này. Không chạy migration remote; nếu không có Supabase CLI/local DB thì ghi rõ SQL chưa được kiểm chứng thực thi. Không chạy full test/build.
>
> Cuối lượt báo danh sách migration, bảng/constraint quan trọng và mọi mâu thuẫn chưa giải quyết; không tự đoán nghiệp vụ.

**Nghiệm thu:** database trống dựng được theo migration mới về mặt cấu trúc; không có FK sang bảng EduSync; RLS/GRANT không mở dữ liệu answer/session cho anon; không đụng Supabase remote.

---

## Giai đoạn 3 — Thay auth và quy trình quản lý tài khoản

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Đọc schema design và các file: `lib/server-auth.ts`, `lib/supabase.ts`, `lib/supabase-server.ts`, `lib/supabase-admin-server.ts`, `lib/olympia/olympia-auth.ts`, `lib/olympia-access.ts`, `actions/olympia/match.actions.ts`, `actions/olympia/permissions.actions.ts`, trang admin accounts, các dialog Create/Edit participant và login components hiện tại.
>
> Thêm `@supabase/ssr` bằng pnpm và triển khai Supabase browser/server clients theo cách phù hợp Next.js hiện tại. Bỏ decode JWT thủ công để tin `sub`; ở server trust boundary phải dùng xác thực `auth.getUser()`. Không query `auth.users` như một bảng PostgREST bình thường.
>
> Thay auth context `authUid/appUserId` bằng một canonical Auth UID. Tạo helper hẹp: yêu cầu người dùng đăng nhập, yêu cầu Olympia Admin, kiểm tra participant membership và kiểm tra MC session grant. Admin lấy quyền từ bảng Olympia riêng, người dùng thường không thể tự gán quyền.
>
> Rebuild trang quản lý tài khoản để đọc `olympia.profiles`, role và participant status; bỏ `public.users`, `user_profiles`, `classes` và resolver role EduSync. Quy trình Admin tạo tài khoản phải dùng Supabase Admin Auth API phía server, bảo đảm profile tồn tại, đăng ký participant khi cần và chỉ cấp role cho phép. Không đưa service-role key vào client. Không mở public self-signup hoặc cho người dùng tự cấp quyền admin.
>
> Giữ URL `/login` nhưng chuyển sang Olympia sign-in. Thêm hướng dẫn/bootstrap script tạo admin đầu tiên bằng cấu hình cục bộ an toàn; không hard-code email, ID hay secret; không tự động cấp admin cho user đầu tiên.
>
> Cập nhật admin layout/helpers. Trong code Olympia runtime, tìm và loại query `appUserId`, `getServerRoles`, `summarizeRoles`, `user_profiles`, `classes`, `public.users`, role EduSync. Không dựng compatibility shim tiếp tục query EduSync chỉ để pass TypeScript. Chưa refactor payload game/realtime ngoài nơi cần đổi chữ ký auth.
>
> Không chạy full test/build. Báo các call-site còn dùng auth cũ nếu có.

**Nghiệm thu:** login/account/admin độc lập; không query bảng EduSync; không tin JWT tự decode; admin provisioning chỉ ở server.

---

## Giai đoạn 4 — Chuyển question bank, participant và truy vấn trận

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Dùng `docs/architecture/OLYMPIA_SOURCE_AUDIT.md` và `docs/architecture/OLYMPIA_SCHEMA_TARGET_DESIGN.md`; chỉ kiểm tra các file được liệt kê: `actions/olympia/match.actions.ts`, `components/olympia/shared/game/useOlympiaGameState.ts`, `components/olympia/admin/matches/HostQuestionPreviewCard.tsx`, `components/olympia/shared/game/OlympiaQuestionsPreloadOverlay.tsx`, `app/(olympia)/olympia/(admin)/admin/matches/[matchId]/host/server/round-questions-cache.ts`, `.../server/types.ts`, các page `game`, `mc`, `guest`, `watch`, admin match detail, API match-player, `types/olympia/game.ts`, question bank pages/actions/components và script seed nào còn tham chiếu bảng `questions`.
>
> Chỉ dùng `question_set_items` làm ngân hàng chỉnh sửa. Giữ snapshot trên `round_questions` để thay đổi ngân hàng không làm đổi trận đã cấu hình. Gỡ mọi nested select `questions(...)`, `round_questions.question_id`, join kép, type và fallback tương ứng; cập nhật query/cache/client type đồng bộ. Không chỉ thay chuỗi; giữ nguyên quy tắc chọn câu, category/code prefix và snapshot lúc tạo trận.
>
> Chuyển truy vấn user/profile sang schema Olympia; bỏ truy vấn `public.users`, `public.user_profiles`, `public.classes` hoặc `.from('auth.users')`. Dùng profile và participant membership để hiển thị tên/an toàn.
>
> Giữ `obstacle_guesses` làm lịch sử đoán từ khóa CNV duy nhất; không ghi một lần đoán trùng vào cả `answers` và `obstacle_guesses`. `answers` dùng cho đáp án gắn với `round_questions`.
>
> Chỉ chạy search có phạm vi với các bảng/cột legacy. Không chạy full test mặc định; nếu có typecheck nhanh thì báo kết quả và sửa lỗi do thay đổi trong phạm vi này.

**Nghiệm thu:** không còn query phụ thuộc `questions`, `round_questions.question_id`, hay bảng identity/class EduSync; types/query cùng schema mới.

---

## Giai đoạn 5 — Session credentials, xác thực MC và bảo vệ dữ liệu server

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Đọc `actions/olympia/permissions.actions.ts`, `app/api/olympia/verify-mc-password/route.ts`, page join/game/guest/MC/watch, các form/dialog tương ứng và schema design.
>
> Thay `session_verifications` bằng `session_access_grants`. Khi xác minh join/MC thành công, tạo opaque random token ngắn hạn, gửi qua cookie HttpOnly/Secure/SameSite phù hợp và chỉ lưu hash token trong DB. Grant phải gắn session + scope `player` hoặc `mc`, có expiry và revoke. Server kiểm grant trước khi trả dữ liệu riêng. Guest không được cấp player/MC capability. Không dùng cờ client `unlocked` làm authorization.
>
> Sinh join code và mật khẩu bằng Node `crypto` CSPRNG có kiểm tra va chạm/retry. Tăng entropy mật khẩu phòng so với 6 ký tự hex hiện tại; hash có pepper server-only và giới hạn thử sai. Nếu cần Admin xem lại mật khẩu đang dùng, dùng AES-256-GCM mã hóa ciphertext hiện tại với `OLYMPIA_CREDENTIAL_ENCRYPTION_KEY`; không lưu plaintext hoặc lịch sử mật khẩu cũ. Nếu key thiếu, thao tác xem lại phải fail closed; không log mật khẩu.
>
> Update UI xem/đổi mật khẩu. Trang MC phải kiểm tra grant trên server **trước khi fetch/serialize answer key hoặc private note**. Trang game/Guest/Watch chỉ nhận public projection; không query answer đầy đủ rồi giấu ở frontend.
>
> Kiểm tra/đổi route API `match-players`, `host/snapshot` và API xác minh MC: authorization rõ ràng trong handler, validate input, response chỉ gồm fields mà caller được xem. Giữ nguyên URL nếu không bắt buộc đổi.
>
> Không chạy full test/build, không chạy remote migration. Cuối lượt nêu rõ cách server bảo vệ player, MC, guest và host data.

**Nghiệm thu:** server quyết định quyền; credential/token không lưu plaintext; câu trả lời chuẩn không xuất hiện trong dữ liệu Guest/player trước khi Host công bố.

---

## Giai đoạn 6 — Tách Realtime công khai/riêng và tính toàn vẹn điểm

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Đọc migration realtime cũ và các file: `actions/olympia/realtime.actions.ts`, `actions/olympia/scoring.actions.ts`, `components/olympia/shared/game/useOlympiaGameState.ts`, `AnswersOverlay.tsx`, `LiveScoreboard.tsx`, `HostAutoSync.tsx`, `HostAnswersByTimeCard.tsx`, `HostLiveAnswersCard.tsx`, `HostRealtimeEventsListener.tsx`, `components/olympia/client/client/LiveScheduleRealtime.tsx`.
>
> Loại bỏ quyền anon đọc raw game tables và raw event data. Public Realtime payload phải có allowlist và an toàn với Guest/Participant; không gồm answerText, đúng/sai trước công bố, private note, mật khẩu/hash/ciphertext hay token. Host/MC dùng server-authorized read hoặc private stream có grant được xác minh thật. Giữ tên event và trải nghiệm hiện tại nếu có thể; nếu đổi payload vì bảo mật thì cập nhật mọi consumer trong cùng thay đổi.
>
> Cấu hình Realtime cho custom schema mới. So sánh Postgres Changes với RLS và Broadcast theo khả năng thực tế của client hiện tại; không đơn giản cấp anon SELECT trên `realtime_events`. Nếu cookie capability MC không thể dùng thẳng để xác thực Supabase Realtime, dùng server-authorized endpoint/stream thay vì tin cờ client.
>
> Với điểm số, giữ nguyên luật tính điểm nhưng bảo đảm cập nhật `answers`, `match_scores`, `score_changes` cùng transaction qua PostgreSQL RPC/function phía server. Tương tự, xác định người thắng buzzer bằng thời gian/transaction phía server, không theo thứ tự client gửi đến browser. Chỉ triển khai RPC khi hợp đồng có thể xác nhận từ action và docs; nếu luật chưa rõ thì ghi blocker, không tự đặt luật mới. Undo phải giữ lịch sử audit.
>
> Không redesign UI. Chạy kiểm tra hẹp cần thiết cho SQL/function, không chạy full suite mặc định. Không push migration.

**Nghiệm thu:** event công khai an toàn, Host/MC có đường riêng, không có quyền anon đọc rộng, điểm và score history không lệch sau một mutation hợp lệ.

---

## Giai đoạn 7 — Dọn EduSync residue và kiểm tra app độc lập

**Prompt giao agent:**

> Chỉ làm trong `D:\app\olympia`. Dùng scoped search các chuỗi branding/import/table EduSync trong `app`, `actions/olympia`, `components/olympia`, `lib`, `proxy.ts`, `package.json`, `supabase/config.toml`, `README.md`, scripts và docs. Không quét repo tùy tiện.
>
> Chỉ xóa module khi chứng minh không còn import/feature phụ thuộc: route groups EduSync ngoài `app/(olympia)/olympia`, school violation components/actions, login cũ, seed user EduSync, version injection/PWA nếu app mới quyết định bỏ. Giữ UI primitives cần dùng, styles, sound/assets, workbook import và tài liệu Olympia. Thay `app/page.tsx`, root layout/metadata, proxy và README cho ứng dụng Olympia. Giữ URL `/olympia/...` trong đợt này.
>
> Đảm bảo `.env.local.example` chỉ chứa giá trị mẫu và `.gitignore` bỏ qua `.env.local`, `.env.*` (trừ example), `node_modules`, `.next`, build output, log, cache và local Supabase temp files. Vẫn track migration SQL. Không xóa file `.env.local` trên máy chủ dự án nếu tồn tại.
>
> Chỉ chạy checks tối thiểu lúc này: xác minh pnpm lock/dependency, `pnpm exec tsc --noEmit` và production build nếu khả thi. Nếu gặp blocker đầu tiên thì báo cụ thể; không tốn token sửa warning không liên quan. Kiểm tra search có phạm vi cho thấy runtime không còn query identity/class EduSync và payload client không chứa đáp án riêng trước công bố.
>
> Không chạy migration remote, deploy, `git clean` hay lệnh Git phá hủy. Chưa init/commit Git cho đến khi owner review summary file thay đổi.

**Nghiệm thu:** shell và cấu hình độc lập, route Olympia hoạt động, không còn module EduSync không cần thiết; kết quả typecheck/build được báo trung thực.

---

## Giai đoạn 8 — Khởi tạo Git local an toàn

**Prompt giao agent:**

> Chỉ thực hiện sau khi Giai đoạn 7 đã được owner xem xét. Khởi tạo Git repo mới trong `D:\app\olympia`, nhánh `main`. Trước khi stage, xác nhận `git rev-parse --show-toplevel` đúng là `D:\app\olympia`; không chạy bất kỳ Git command nào tại `D:\app\edu-sync`.
>
> Kiểm tra `git status --short` và `.gitignore`; xác nhận `.env.local`, secret, Supabase local temp, build log và generated artifact không được stage. Stage dự án Olympia sạch và tạo một commit đầu tiên với message `chore: initialize standalone Olympia app`.
>
> Không thêm remote, không push, không tạo GitHub repository, không thay đổi repo EduSync. Báo commit hash và danh sách file đã stage.

**Nghiệm thu:** Git root mới chỉ là Olympia, initial commit sạch, không remote push và không tác động repo cũ.

---

## Các điều kiện bắt buộc phải dừng và báo blocker

Dừng giai đoạn hiện tại, báo rõ bằng chứng thay vì đoán nếu: schema mâu thuẫn luật game; ý nghĩa cột/table chưa rõ; lệnh có thể tác động Supabase remote; thao tác có thể xóa/copy secret, sửa `D:\app\edu-sync`, đổi remote/viết lại history hoặc lộ đáp án; hoặc vai trò/quyền hiện tại không thể bảo toàn nếu không tự đặt quy tắc nghiệp vụ mới.
