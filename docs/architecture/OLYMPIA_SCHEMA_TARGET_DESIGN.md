# Olympia độc lập — Thiết kế kiến trúc và database mục tiêu

> Trạng thái: **Bản thiết kế đề xuất để review — chưa phải SQL chạy được**  
> Nguồn hiện trạng: ZIP EduSync do chủ dự án gửi, các migration trong `supabase/migrations`, schema tổng hợp trong `docs/supabase/schemas`, các tài liệu `docs/specific/olympia-*`, `docs/plans/olympia-competition-plan.md`, tài liệu live-session và các call site trong code Olympia.  
> Nguyên tắc: không migrate dữ liệu cũ; tái sử dụng nghiệp vụ và code đã có; xây baseline mới nhất quán từ database trống.

## 1. Mục tiêu và phạm vi

Dự án mới là ứng dụng Olympia độc lập, dùng Next.js/React/TypeScript và Supabase. Repo EduSync cũ được đóng băng và giữ nguyên. `D:\app\olympia` là working copy nguồn hiện tại; chưa có Git mới tại thời điểm lập tài liệu.

Các hành vi cần bảo toàn:

- Quản lý tài khoản Olympia và quyền quản trị.
- Quản lý tournament, match, tối đa bốn ghế thí sinh, cấu hình bốn vòng.
- Ngân hàng câu hỏi, tạo câu hỏi thủ công, import XLSX, media cho câu hỏi.
- Host là nguồn điều khiển tiến trình trận: bắt đầu/dừng vòng, hiện câu, timer, xác nhận đúng/sai, chuyển câu, kết thúc.
- Participant nộp câu trả lời/bấm chuông; MC xem thông tin nâng cao theo quyền phiên; Guest/Projector xem trạng thái công khai.
- Khởi động, Vượt chướng ngại vật, Tăng tốc, Về đích; theo dõi điểm, ngôi sao, cướp điểm, điều chỉnh/undo và lịch sử.
- Resume/reload và đồng bộ trạng thái theo thời gian thực.

Không mang sang: tài khoản/dữ liệu người dùng cũ, lớp học, vi phạm, complaints, hệ phân quyền EduSync chung, lịch sử trận cũ hoặc lịch sử Git EduSync.

## 2. Cách giải quyết xung đột giữa các nguồn

Ưu tiên nguồn theo mục đích:

1. **Code và query hiện tại** cho biết ứng dụng đang thực sự đọc/ghi gì.
2. **Migration SQL** cho biết trình tự tạo schema cũ, nhưng không được xem mặc nhiên là schema đúng cuối cùng.
3. **Schema tổng hợp** giúp tra nhanh cột/quan hệ, nhưng có thể lệch migration hoặc runtime.
4. **Đặc tả nghiệp vụ** (`olympia-game.md`, `olympia-rule.md`) quyết định hành vi cần giữ.
5. **Plan cũ** cung cấp bối cảnh, không tự động thắng code hiện tại.

Ví dụ đã xác minh trong nguồn: code truy vấn `question_set_items` làm ngân hàng câu hỏi chính; bảng `questions` vẫn xuất hiện trong một số query/kiểu dữ liệu và cần được gỡ đồng bộ. `obstacle_guesses` chưa thể xóa ngay vì Host fetch vẫn truy vấn bảng này, dù một số action đã ghi nhận lượt đoán CNV qua `answers`. `matches.code` được nêu trong một tài liệu URL cũ nhưng route hiện tại dùng UUID `matches.id` và `live_sessions.join_code`; không đưa `matches.code` vào schema đích nếu chưa có yêu cầu sản phẩm khác.

## 3. Quyết định kiến trúc tổng thể

### 3.1 Giữ schema `olympia`

Giữ custom schema `olympia` vì code hiện tại chủ động gọi `supabase.schema("olympia")`. Không đổi toàn bộ bảng sang `public` chỉ để đơn giản hóa. Dự án Supabase mới phải cấu hình Exposed schemas/GRANT đúng; chỉ tạo schema là chưa đủ.

### 3.2 Dùng Auth UID làm định danh tài khoản xuyên suốt

Trong EduSync có hai ID: `auth.users.id` và `public.users.id`. Olympia dùng ID nội bộ `public.users.id` ở nhiều FK và `server-auth.ts` thực hiện ánh xạ thủ công. Thiết kế mới loại lớp ánh xạ này.

- `auth.users.id` là canonical user ID.
- `olympia.profiles.id` bằng và FK tới `auth.users.id`.
- Các cột `created_by`, `host_user_id`, `uploaded_by`, `reverted_by`, `generated_by`, `user_id` liên quan tài khoản tham chiếu profile/Auth UID theo cùng một quy ước.
- Không copy `public.users`, `public.user_profiles`, `public.user_roles`, `public.permissions`, `public.classes`, `public.grades` hay bảng nghiệp vụ vi phạm sang.

### 3.3 Quyền hệ thống khác với vai trò trong trận/phiên

- `admin` là quyền toàn hệ thống và được lưu trong bảng role riêng.
- `participant` là tư cách thi đấu; chỉ người được đăng ký thí sinh mới có hàng trong `participants`.
- `MC` không nên là role toàn hệ thống theo thiết kế mặc định: hiện code xác minh MC bằng mật khẩu phiên, không phải một quy trình Auth nhất quán. MC được cấp quyền theo phiên qua grant/credential.
- `Guest` là người xem công khai; không phải tài khoản có role trong database.
- `MOD` đang xuất hiện trong một số option/form nhưng schema cũ chỉ cho `AD` hoặc NULL và guard quản trị chỉ chấp nhận `AD`. Chưa đưa `MOD` vào schema đích cho đến khi có đặc tả quyền rõ ràng; UI phải bỏ hoặc định nghĩa lại, không giữ role chết.

## 4. Schema bảng mục tiêu đề xuất

Tên bảng dưới đây dự kiến nằm trong `olympia.*`. Đây là danh mục và hợp đồng dữ liệu, chưa phải SQL cuối cùng.

### 4.1 Danh tính và quyền

#### `profiles`

- `id uuid PK FK -> auth.users(id) ON DELETE CASCADE`
- `email text` (đồng bộ từ Auth bởi server/trigger; chỉ hiển thị cho bản thân/admin)
- `display_name text NOT NULL`
- `avatar_url text NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`

Tạo profile khi tạo tài khoản bằng cơ chế tin cậy; không cấp role admin tự động trong trigger profile.

#### `user_roles`

- `user_id uuid FK -> profiles(id) ON DELETE CASCADE`
- `role text NOT NULL CHECK (role IN ('admin'))` ở baseline đầu
- `granted_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- PK (`user_id`, `role`)

Không cần mang mô hình permission/scope/target tổng quát của EduSync khi chỉ có quyền Olympia Admin được xác định rõ. Nếu sau này có Operator/Moderator với ma trận quyền cụ thể, bổ sung riêng sau.

#### `participants`

- `user_id uuid PK FK -> profiles(id) ON DELETE CASCADE`
- `contestant_code text NOT NULL UNIQUE`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`

Không chứa role admin/MC. Người không phải thí sinh không cần tạo participant. Người dùng vừa admin vừa thí sinh có thể có cả `user_roles` và `participants`.

### 4.2 Giải, trận, người thi và vòng

#### `tournaments`

- `id uuid PK DEFAULT gen_random_uuid()`
- `name text NOT NULL`
- `description text NULL`
- `starts_at timestamptz NULL`, `ends_at timestamptz NULL`
- `status text NOT NULL DEFAULT 'planned' CHECK IN ('planned','active','archived')`
- `created_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`

Tournament là lớp gom nhiều trận nhưng không bắt buộc để tạo trận lẻ.

#### `matches`

- `id uuid PK DEFAULT gen_random_uuid()`
- `tournament_id uuid NULL FK -> tournaments(id) ON DELETE SET NULL`
- `name text NOT NULL`
- `scheduled_at timestamptz NULL`
- `status text NOT NULL DEFAULT 'draft' CHECK IN ('draft','scheduled','live','finished','cancelled')`
- `host_user_id uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`

Không thêm `matches.code` ở baseline vì đường dẫn công khai hiện dùng `live_sessions.join_code`, còn admin dùng `matches.id` UUID.

#### `match_players`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `participant_id uuid NOT NULL FK -> participants(user_id) ON DELETE RESTRICT`
- `seat_index smallint NULL CHECK (seat_index IS NULL OR seat_index BETWEEN 1 AND 4)`
- `display_name text NULL` (snapshot tên tại trận nếu code giữ chức năng override)
- `is_disqualified_obstacle boolean NOT NULL DEFAULT false`
- `created_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`match_id`, `participant_id`)
- UNIQUE (`match_id`, `seat_index`); Postgres cho phép nhiều NULL, giữ tương thích thao tác chưa gán ghế.

Không xóa participant đang được dùng bởi match; xóa tài khoản cần luồng vô hiệu hóa/ẩn hoặc quy trình xử lý lịch sử, tránh cascade xóa lịch sử thi đấu.

#### `match_rounds`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `round_type text NOT NULL CHECK IN ('khoi_dong','vcnv','tang_toc','ve_dich')`
- `order_index smallint NOT NULL`
- `config jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`match_id`, `round_type`), UNIQUE (`match_id`, `order_index`)

Giữ cấu hình vòng trong `config` vì thời gian/điểm có thể chỉnh theo trận; giá trị mặc định phải phù hợp luật đặc tả và code tính điểm.

### 4.3 Ngân hàng câu hỏi và câu hỏi của trận

#### `question_sets`

- `id uuid PK DEFAULT gen_random_uuid()`
- `name text NOT NULL`
- `original_filename text NULL`
- `item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0)`
- `uploaded_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`

Giữ `item_count` do UI/logic hiện tại sử dụng, nhưng database trigger hoặc một hàm transaction phải là nguồn duy trì chính xác; không duy trì cùng lúc bằng nhiều thao tác client rời rạc.

#### `question_set_items`

- `id uuid PK DEFAULT gen_random_uuid()`
- `question_set_id uuid NOT NULL FK -> question_sets(id) ON DELETE CASCADE`
- `order_index integer NOT NULL CHECK (order_index >= 0)`
- `code text NOT NULL`
- `category text NULL`
- `question_text text NOT NULL`
- `answer_text text NOT NULL`
- `note text NULL`
- `submitted_by text NULL` (nguồn/tác giả được khai báo trong bộ đề, không dùng làm ID tài khoản)
- `source text NULL`
- `image_path text NULL`, `audio_path text NULL` (đường dẫn object Storage, không lưu public URL làm định danh asset)
- `created_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`question_set_id`, `order_index`)
- Khuyến nghị UNIQUE (`question_set_id`, `code`) vì importer hiện bỏ qua mã trùng trong một bộ đề; cần xác minh mọi workflow tạo thủ công phù hợp trước khi bật constraint.

`question_set_items` là nguồn ngân hàng chính. `questions` là bảng legacy song song, không được dùng làm nguồn thứ hai.

#### `match_question_sets`

- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `question_set_id uuid NOT NULL FK -> question_sets(id) ON DELETE RESTRICT`
- `created_at timestamptz NOT NULL DEFAULT now()`
- PK (`match_id`, `question_set_id`)

Giữ liên kết bộ đề với trận vì code quản lý bộ đề và tạo câu hỏi theo bộ.

#### `round_questions`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_round_id uuid NOT NULL FK -> match_rounds(id) ON DELETE CASCADE`
- `question_set_item_id uuid NULL FK -> question_set_items(id) ON DELETE SET NULL`
- `order_index smallint NOT NULL CHECK (order_index >= 0)`
- `target_player_id uuid NULL FK -> match_players(id) ON DELETE SET NULL`
- `meta jsonb NOT NULL DEFAULT '{}'::jsonb`
- Snapshot: `question_text text NULL`, `answer_text text NULL`, `note text NULL`, `image_path text NULL`, `audio_path text NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`match_round_id`, `order_index`)

Snapshot nội dung để chỉnh sửa ngân hàng không thay đổi nội dung của trận đã cấu hình. Khi sinh round question, copy text/answer/note và locator media vào snapshot. Không có `question_id`; loại bỏ join kép `questions` + `question_set_items` sau khi sửa các call site/seed/types.

### 4.4 Vượt chướng ngại vật

#### `obstacles`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_round_id uuid NOT NULL UNIQUE FK -> match_rounds(id) ON DELETE CASCADE`
- `title text NULL`
- `final_keyword text NOT NULL`
- `image_path text NULL`
- `meta jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL DEFAULT now()`

#### `obstacle_tiles`

- `id uuid PK DEFAULT gen_random_uuid()`
- `obstacle_id uuid NOT NULL FK -> obstacles(id) ON DELETE CASCADE`
- `round_question_id uuid NULL FK -> round_questions(id) ON DELETE SET NULL`
- `position_index smallint NOT NULL CHECK (position_index >= 0)`
- `is_open boolean NOT NULL DEFAULT false`
- UNIQUE (`obstacle_id`, `position_index`)

#### `obstacle_guesses`

**Giữ trong baseline mới.** Dù một số scoring actions đã chuyển việc ghi nhận đoán CNV sang `answers`, Host data fetch hiện vẫn đọc `obstacle_guesses`. Bảng này cũng biểu diễn nỗ lực đoán từ khóa CNV, khác với câu trả lời cho một câu hỏi hàng ngang.

- `id uuid PK DEFAULT gen_random_uuid()`
- `obstacle_id uuid NOT NULL FK -> obstacles(id) ON DELETE CASCADE`
- `player_id uuid NOT NULL FK -> match_players(id) ON DELETE CASCADE`
- `guess_text text NOT NULL`
- `is_correct boolean NOT NULL DEFAULT false`
- `attempt_order smallint NULL CHECK (attempt_order IS NULL OR attempt_order > 0)`
- `attempted_at timestamptz NOT NULL DEFAULT now()`

Ở giai đoạn chuyển code, phải chọn **một nguồn sự thật** cho guess history. Thiết kế dễ tương thích nhất hiện tại là `obstacle_guesses` giữ lịch sử keyword guesses, còn `answers` giữ câu trả lời gắn với `round_questions`; không ghi cùng một lần đoán vào hai bảng nếu UI có thể dùng một bảng.

### 4.5 Phiên trực tiếp, xác minh truy cập và câu trả lời

#### `live_sessions`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL UNIQUE FK -> matches(id) ON DELETE CASCADE` (một session hiện hành trên mỗi match theo cách code dùng `.maybeSingle()` và tái sử dụng session)
- `join_code text NOT NULL UNIQUE`
- `status text NOT NULL DEFAULT 'pending' CHECK IN ('pending','running','ended')`
- `current_round_id uuid NULL FK -> match_rounds(id) ON DELETE SET NULL`
- `current_round_type text NULL CHECK (current_round_type IS NULL OR current_round_type IN ('khoi_dong','vcnv','tang_toc','ve_dich'))`
- `current_round_question_id uuid NULL FK -> round_questions(id) ON DELETE SET NULL`
- `question_state text NOT NULL DEFAULT 'hidden' CHECK IN ('hidden','showing','answer_revealed','completed')`
- `timer_deadline timestamptz NULL`, `ended_at timestamptz NULL`
- `created_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `requires_player_password boolean NOT NULL DEFAULT true`
- `player_password_hash text NULL`, `mc_password_hash text NULL`
- `player_password_ciphertext text NULL`, `mc_password_ciphertext text NULL` — chỉ để duy trì khả năng Admin xem lại **mật khẩu hiện hành**, mã hóa ở server bằng secret key không nằm trong DB; không lưu plaintext.
- `buzzer_enabled boolean NOT NULL DEFAULT true`
- `show_scoreboard_overlay boolean NOT NULL DEFAULT false`
- `show_answers_overlay boolean NOT NULL DEFAULT false`
- `guest_media_control jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`

Tạo join code bằng CSPRNG, kiểm tra va chạm và retry; không dùng `Math.random()`. Mật khẩu nên có entropy phù hợp. Nếu quyết định không giữ UI xem lại mật khẩu, bỏ ciphertext và chỉ hiện mật khẩu một lần sẽ đơn giản hơn; phải chốt trước khi viết auth/session code.

#### `session_access_grants` (thay mô hình xác minh phiên cũ)

Đề xuất thay `session_verifications` bằng capability grant có scope, để mô hình truy cập player/MC/guest rõ ràng hơn và có thể hết hạn/thu hồi.

- `id uuid PK DEFAULT gen_random_uuid()`
- `session_id uuid NOT NULL FK -> live_sessions(id) ON DELETE CASCADE`
- `user_id uuid NULL FK -> profiles(id) ON DELETE CASCADE` (gắn với tài khoản nếu có)
- `access_type text NOT NULL CHECK IN ('player','mc','guest')`
- `token_hash text NOT NULL UNIQUE` (không lưu bearer token nguyên văn)
- `created_at timestamptz NOT NULL DEFAULT now()`
- `expires_at timestamptz NOT NULL`
- `revoked_at timestamptz NULL`
- Index theo (`session_id`, `access_type`, `expires_at`); policy không cho client tự phát hành grant.

Grant token thô chỉ ở cookie HttpOnly/Secure/SameSite phù hợp; server mới hash/tra cứu và kiểm scope. Khi hết session, đổi password hoặc revoke, vô hiệu hóa grant thích hợp. Với player đã đăng nhập vẫn xác thực Auth UID và tư cách participant; join code/password không tự cấp quyền chấm điểm/điều khiển.

#### `answers`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `match_round_id uuid NOT NULL FK -> match_rounds(id) ON DELETE CASCADE`
- `round_question_id uuid NOT NULL FK -> round_questions(id) ON DELETE CASCADE`
- `player_id uuid NOT NULL FK -> match_players(id) ON DELETE CASCADE`
- `answer_text text NULL`
- `is_correct boolean NULL` (NULL trước khi Host quyết định)
- `points_awarded integer NOT NULL DEFAULT 0`
- `response_time_ms integer NULL CHECK (response_time_ms IS NULL OR response_time_ms >= 0)`
- `submitted_at timestamptz NOT NULL DEFAULT now()`

Không đặt UNIQUE (`round_question_id`, `player_id`) lúc này: code có insert nhiều answer records trong một số flow và game cần lưu attempt history. Cần thêm composite validation/RPC để bảo đảm `match_id`, `match_round_id`, question và player thực sự thuộc cùng match; foreign key từng cột riêng không tự bảo đảm quan hệ chéo này.

`session_id`/`notes` từ migration gốc không được giữ nếu call site runtime không cần. Dùng `match_round_id`/`response_time_ms` nhất quán với code đang dùng.

#### `session_password_history`

Không giữ dạng cũ. Bảng này được code dùng chủ yếu để truy xuất plaintext mật khẩu hiện hành, không có migration tạo trong chuỗi nguồn và có cột plaintext nhạy cảm. Dùng ciphertext hiện hành trong `live_sessions` nếu vẫn cần khả năng xem lại; các lần đổi mật khẩu được ghi event metadata không chứa bí mật.

### 4.6 Điểm số, event và đồng bộ thời gian thực

#### `match_scores`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `player_id uuid NOT NULL FK -> match_players(id) ON DELETE CASCADE`
- `round_type text NOT NULL CHECK IN ('khoi_dong','vcnv','tang_toc','ve_dich')`
- `points integer NOT NULL DEFAULT 0`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`match_id`, `player_id`, `round_type`)

`match_scores` là snapshot nhanh để render scoreboard; phải cập nhật trong cùng transaction với quyết định điểm. Không tự tin vào dữ liệu client gửi lên.

#### `score_changes`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `player_id uuid NOT NULL FK -> match_players(id) ON DELETE CASCADE`
- `round_type text NOT NULL CHECK IN` bốn vòng
- `requested_delta integer NOT NULL`, `applied_delta integer NOT NULL`
- `points_before integer NOT NULL`, `points_after integer NOT NULL`
- `source text NOT NULL DEFAULT 'system'` (giới hạn thành giá trị được định nghĩa trong ứng dụng)
- `reason text NULL`
- `round_question_id uuid NULL FK -> round_questions(id) ON DELETE SET NULL`
- `answer_id uuid NULL FK -> answers(id) ON DELETE SET NULL`
- `revert_of uuid NULL FK -> score_changes(id) ON DELETE SET NULL`
- `reverted_at timestamptz NULL`
- `reverted_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_by uuid NULL FK -> profiles(id) ON DELETE SET NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`

Undo nên tạo bản ghi bù, không xóa lịch sử. Việc ghi score + audit nên qua PostgreSQL RPC/function có transaction để tránh một phần thao tác thành công còn phần khác thất bại.

#### `buzzer_events`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `round_question_id uuid NOT NULL FK -> round_questions(id) ON DELETE CASCADE`
- `player_id uuid NULL FK -> match_players(id) ON DELETE SET NULL`
- `event_type text NOT NULL CHECK IN ('buzz','steal','reset')`
- `result text NULL` (giới hạn enum ứng dụng sau khi rà soát mọi giá trị ghi thực tế)
- `occurred_at timestamptz NOT NULL DEFAULT now()`

`reset` phải nằm trong constraint vì code đang ghi `event_type = 'reset'` nhưng migration gốc chỉ cho `buzz`/`steal`. Ai thắng buzzer phải được quyết định bằng server timestamp/transaction; realtime chỉ thông báo kết quả đã được chấp nhận.

#### `star_uses`

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `round_question_id uuid NOT NULL FK -> round_questions(id) ON DELETE CASCADE`
- `player_id uuid NOT NULL FK -> match_players(id) ON DELETE CASCADE`
- `outcome text NULL` (chuẩn hóa tập giá trị sau rà soát UI/actions)
- `declared_at timestamptz NOT NULL DEFAULT now()`
- UNIQUE (`match_id`, `round_question_id`, `player_id`) nếu upsert logic tiếp tục dựa vào bộ khóa này.

#### `realtime_events`

Dùng làm nguồn sự kiện/payload realtime nhẹ, **không** là bảng có thể cấp SELECT công khai vô hạn với mọi payload.

- `id uuid PK DEFAULT gen_random_uuid()`
- `match_id uuid NOT NULL FK -> matches(id) ON DELETE CASCADE`
- `session_id uuid NULL FK -> live_sessions(id) ON DELETE CASCADE`
- `entity text NOT NULL`, `entity_id uuid NULL`, `event_type text NOT NULL`
- `payload jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL DEFAULT now()`
- Index (`match_id`, `created_at DESC`), (`session_id`, `created_at DESC`)

Contract event công khai không bao giờ chứa `answer_text`, đáp án đúng/sai trước khi Host công bố, credential/hash/ciphertext, ghi chú nội bộ hoặc dữ liệu riêng khác. Có thể phát public state/event với payload tối thiểu; dữ liệu Host/MC cần bảo vệ phải được tải qua server endpoint đã xác minh quyền. Không cấp anon quyền đọc bảng nghiệp vụ hoặc private payload chỉ để giúp Guest subscribe realtime. Có thể dùng Realtime Broadcast channel với capability/grant theo phiên hoặc một luồng công khai đã lọc; lựa chọn cụ thể phải được xác minh với cách subscribe hiện tại trước khi code.

## 5. Bảng loại bỏ/thay thế

| Thành phần cũ | Quyết định | Lý do / việc cần làm |
|---|---|---|
| `public.users` | Bỏ khỏi ứng dụng mới | Dùng Auth UID trực tiếp qua `olympia.profiles` |
| `public.user_profiles` | Thay bằng `olympia.profiles` | Giảm query/join cũ |
| `public.permissions`, `public.user_roles` | Bỏ mô hình EduSync | Dùng `olympia.user_roles` tối giản |
| `public.classes`, `grades`, `criteria`, `records`, `complaints`, `notifications` | Bỏ | Không thuộc chức năng Olympia cần giữ |
| `olympia.questions` | Bỏ sau khi sửa sạch call sites | Ngân hàng chính là `question_set_items`; loại bỏ join kép |
| `round_questions.question_id` | Bỏ | Legacy link sang `questions` |
| `live_sessions.player_password` / `mc_view_password` chứa hash dưới tên thiếu rõ nghĩa | Đổi thành `*_password_hash` và tùy chọn `*_password_ciphertext` | Rõ semantics, hỗ trợ kiểm tra và hiển thị an toàn |
| `session_verifications` | Thay bằng `session_access_grants` nếu mô hình capability được chấp thuận | Role/session scope + expiry/revocation rõ hơn |
| `session_password_history` chứa plaintext | Bỏ | Hiện code dùng để xem lại password; thay bằng ciphertext hiện hành hoặc quyết định chỉ hiển thị một lần |
| `obstacle_guesses` | Giữ ở baseline | Code Host hiện vẫn đọc bảng; loại bỏ chỉ trong đợt refactor được kiểm tra riêng |
| `matches.code` | Không thêm | Chưa được xác nhận bởi runtime; `join_code` thuộc `live_sessions` |

## 6. RLS, GRANT và quyền truy cập dự kiến

Bật RLS trên tất cả bảng thuộc custom schema có thể truy cập qua Data API. Không áp dụng `GRANT SELECT` cho `anon, authenticated` hàng loạt như migration cũ.

| Dữ liệu | Admin | Participant đã được xác minh | MC đã được xác minh | Guest |
|---|---|---|---|---|
| Profiles/email | Quản trị qua server | Hồ sơ của mình | Không mặc định | Không |
| Question bank + đáp án chuẩn | Có | Không trực tiếp | Chỉ câu/trận/phiên cần thiết | Không |
| Match roster + scoreboard | Có | Dữ liệu cần thiết cho trận của mình | Dữ liệu trình chiếu/đọc nâng cao | Chỉ dữ liệu công khai |
| Submit answer / buzzer | Thao tác điều khiển hợp lệ | Submit cho chính mình qua server | Không | Không |
| Score changes / undo | Có qua nghiệp vụ server | Không | Không | Không |
| Live session controls/credentials | Có qua server | Không | Không | Không |
| Public realtime events | Có | Theo session grant | Theo session grant | Theo session grant / kênh công khai đã lọc |

Nguyên tắc implement:

- `auth.getUser()`/SSR session là cơ sở xác thực; không tự decode JWT cookie để tin `sub`.
- Client không được tự insert `user_roles` hoặc tạo grant cho chính mình.
- Tạo/xóa tài khoản Auth dùng Admin API phía server; service-role key tuyệt đối không vào browser bundle.
- Các thao tác có tính quyết định (Host state, chọn buzzer winner, xác nhận điểm, undo, cấp session grant) phải được kiểm tra quyền tại server, và thao tác cập nhật liên quan nên chạy transaction/RPC.
- Không để Guest/Participant query `round_questions.answer_text` hoặc event payload riêng trước khi công bố.

## 7. Storage và media câu hỏi

Dự kiến dùng bucket `olympia-assets` **private**. Database lưu object path (`image_path`, `audio_path`) chứ không lưu public URL làm định danh tài nguyên. Server tạo signed URL đúng thời điểm/quyền truy cập:

- Admin: xem/tải media trong kho câu hỏi.
- Host/MC: được xem media liên quan trận theo quyền.
- Participant/Guest: chỉ nhận signed URL của asset cần hiển thị trong trạng thái hiện tại đã công bố.

Nếu cần hỗ trợ URL ngoài Storage, tách riêng trường URL ngoài và validate scheme/host; không trộn URL public với storage path trong cùng trường mà không có quy tắc nhận dạng.

## 8. Cấu trúc migration mới

Không dùng lại 21 migration cũ như migration khởi tạo cho database mới. Tạo lịch sử migration riêng, sạch và có thứ tự xác định:

1. `0001_olympia_core.sql`: schema, profiles/roles/participants, tournament/match/round/players, question sets/items/snapshots, obstacle tables, answers/scoring/session tables và constraints/index.
2. `0002_auth_profiles_and_rbac.sql`: trigger tạo profile (nếu chọn trigger), hàm kiểm quyền tối thiểu, bootstrap Admin có hướng dẫn riêng; không hard-code secret.
3. `0003_rls_grants.sql`: RLS và GRANT tối thiểu cho từng bảng.
4. `0004_storage.sql`: bucket private và policy upload/download.
5. `0005_realtime.sql`: stream an toàn, trigger/functions, publication/channel contract; không phát secret/answer fields.
6. `0006_scoring_transactions.sql`: RPC/transaction cho các thao tác điểm quan trọng sau khi hợp đồng action đã chốt.

Tên/tách migration có thể thay đổi, nhưng database trống phải dựng được toàn bộ qua `supabase db reset`/quy trình tương đương. Tạo TypeScript database types sau khi schema baseline ổn định, không sửa tay type cũ còn chứa bảng EduSync.

## 9. Rà soát các sai lệch hiện trạng đã xác minh

1. `question_set_items.question_id` được tạo `NOT NULL` ở migration `20251225090000_add_question_sets.sql`; các migration sau thêm `code` và nội dung trực tiếp rồi chỉ đến `20260101120000` mới drop NOT NULL. Baseline mới bỏ luôn cột legacy `question_id`.
2. Migration gốc `answers` có `session_id`, `notes`, `created_at`, nhưng runtime/schema tổng hợp sử dụng `match_round_id`, `response_time_ms`, `submitted_at`. Baseline phải phản ánh code/runtime đang dùng, không copy migration đầu.
3. `session_password_history` có trong schema tổng hợp và được dùng bởi code, nhưng không có migration tạo bảng tương ứng trong chuỗi migration đi kèm.
4. Migration `grant_public_read_olympia` cấp SELECT rộng cho một số bảng, và migration realtime cấp SELECT cho `realtime_events`. Payload trigger của `answers` có `answerText`/`isCorrect`; không được giữ cách công khai payload này.
5. Code ghi `buzzer_events.event_type = 'reset'`, còn migration gốc chỉ cho `buzz`/`steal`; baseline phải bao gồm `reset`.
6. `participants.role` constraint chỉ cho `AD` hoặc NULL, nhưng một số form/options có `MOD` và helper có nhánh `MC`. Không tái sử dụng cột này làm enum quyền chung.
7. Một số route tải `round_questions.answer_text` hoặc quan hệ answer data trước khi phía client mở khóa MC/Guest. Cần sửa data loading/API contract, không chỉ thêm RLS.
8. `obstacle_guesses` vẫn được Host data fetch đọc, dù scoring action có chỗ ghi guess qua `answers`; giữ bảng ở baseline cho đến khi có quyết định thay thế đầy đủ.
9. Route code hiện dùng `matches.id` và `live_sessions.join_code`; tài liệu URL cũ có đề cập `matches.code` nhưng chưa phải hợp đồng runtime.

## 10. Những điểm cần khóa trước khi viết SQL

Đây không phải câu hỏi buộc chủ dự án trả lời ngay; khuyến nghị mặc định ở cột phải là hướng đề xuất.

| Điểm | Khuyến nghị mặc định |
|---|---|
| Admin được tạo tài khoản thế nào? | Chỉ Admin API server; tài khoản Admin đầu tiên qua script/bootstrap thủ công có kiểm tra |
| Có giữ role `MOD`? | Chưa; định nghĩa ma trận quyền trước khi thêm |
| MC có cần login tài khoản? | Giữ luồng MC bằng mã phòng + password như hiện tại, nhưng grant được xác minh phía server, lưu trong cookie HttpOnly/token hash |
| Có cho admin xem lại password phòng? | Giữ tính năng bằng ciphertext của password hiện hành; không lưu plaintext/history. Nếu muốn giảm phức tạp, hiển thị một lần và bỏ nút xem lại |
| Một match có nhiều live sessions? | Một session hiện hành mỗi match (UNIQUE match_id) như logic hiện tại. Nếu muốn lưu nhiều phiên chạy lại song song/lịch sử session, phải đổi model rõ ràng |
| Có giữ question table thứ hai? | Không; `question_set_items` là nguồn câu hỏi duy nhất, round questions giữ snapshot |
| Giữ obstacle_guesses? | Có, baseline ban đầu để không mất chức năng Host; không duplicate same guess in answers |
| Storage public hay private? | Private; phát signed URL chỉ cho asset được phép hiển thị |
| Realtime public? | Chỉ payload đã lọc; không cho anon đọc raw events/table nội bộ |

## 11. Các bước thực thi sau khi review thiết kế

1. Chuyển bản thiết kế này thành `docs/architecture/database-design.md` trong dự án mới.
2. Tạo một inventory đầy đủ cho imports/call sites của `questions`, `question_set_items`, `answers`, `obstacle_guesses`, session password/history, user/profile/role và mọi direct browser query.
3. Tách dự án/repo mới và cấu hình `package.json`, Next.js, Supabase SSR, env example và TypeScript aliases cần thiết.
4. Viết baseline migration và policies, kiểm tra có thể dựng từ database trống.
5. Tách auth/account actions trước; sau đó sửa API/query/Realtime theo data contract; cuối cùng chuyển scoring-critical mutations sang transaction.
6. Kiểm tra thủ công/automated có trọng điểm theo acceptance criteria ở tài liệu game; không chạy test/lint toàn repo mặc định nếu chưa cần.

## 12. Các tiêu chí nghiệm thu ở mức kiến trúc

- Không còn import/runtime query phụ thuộc `public.users`, `public.user_profiles`, `public.user_roles`, `public.permissions`, `classes` hoặc bảng nghiệp vụ EduSync.
- Một tài khoản mới có thể đăng nhập, có profile và được gán admin an toàn mà không cần tạo user trong EduSync.
- Database trống có thể được khởi tạo từ migrations của dự án Olympia.
- Admin tạo match/bộ đề, cấu hình bốn vòng, gán bốn thí sinh và mở live session.
- Host, Participant, MC và Guest nhìn đúng dữ liệu theo vai trò; đáp án không xuất hiện trong HTML/network/realtime payload của Guest/Participant trước khi Host công bố.
- Submit/buzzer có thứ tự server xác định; tính điểm/undo không để lệch scoreboard với score history.
- Tất cả mật khẩu phòng và token grant không lưu plaintext trong database; service-role/secret key không lộ phía client.
- Ảnh/âm thanh chỉ được cấp URL truy cập phù hợp lúc cần, nếu dùng bucket private như đề xuất.
- Git Olympia độc lập với remote mới; repo EduSync và thay đổi local `public/service-worker.js` không bị động tới.

---

**Lưu ý:** Tài liệu này là bản thiết kế mục tiêu dựa trên ZIP được cung cấp. Chưa có file trong source bị sửa; chưa có SQL migration nào chạy trên Supabase. Trước khi viết migration, cần hoàn tất inventory call-site và chốt hợp đồng Realtime/session grant ở mức triển khai để không tạo schema đúng về hình thức nhưng không khớp ứng dụng.
