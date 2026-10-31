import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { CreateAccountDialog } from "@/components/olympia/admin/accounts/CreateAccountDialog";
import { EditAccountDialog, type OlympiaAccount } from "@/components/olympia/admin/accounts/EditAccountDialog";
import { cn } from "@/utils/cn";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const filterOptions = [
  { id: "all", label: "Tất cả" },
  { id: "admin", label: "Admin" },
  { id: "contestant", label: "Thí sinh" },
  { id: "other", label: "Khác" },
] as const;

type FilterOption = (typeof filterOptions)[number]["id"];

type ProfileRow = { user_id: string; display_name: string | null };
type RoleRow = { user_id: string; role: string };
type ParticipantRow = {
  user_id: string;
  contestant_code: string | null;
  is_active: boolean;
};

type AccountsPageProps = {
  searchParams?: Promise<{ role?: string; q?: string; status?: string }>;
};

async function listAllAuthUsers() {
  const admin = getOlympiaAdminClient();
  const users: User[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

function category(account: OlympiaAccount): FilterOption {
  if (account.isAdmin) return "admin";
  if (account.isParticipant) return "contestant";
  return "other";
}

export default async function OlympiaAdminAccountsPage({ searchParams }: AccountsPageProps) {
  await requireOlympiaAdminContext();
  const admin = getOlympiaAdminClient();
  const users = await listAllAuthUsers();
  const userIds = users.map((user) => user.id);
  const olympia = admin.schema("olympia");

  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }, { data: participants, error: participantsError }] =
    await Promise.all([
      userIds.length
        ? olympia.from("profiles").select("user_id, display_name").in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? olympia.from("user_roles").select("user_id, role").in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? olympia
            .from("participants")
            .select("user_id, contestant_code, is_active")
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const queryError = profilesError ?? rolesError ?? participantsError;
  if (queryError) throw new Error(queryError.message);

  const profileMap = new Map((profiles as ProfileRow[]).map((row) => [row.user_id, row]));
  const adminIds = new Set(
    (roles as RoleRow[]).filter((row) => row.role === "admin").map((row) => row.user_id)
  );
  const participantMap = new Map(
    (participants as ParticipantRow[]).map((row) => [row.user_id, row])
  );

  const accounts: OlympiaAccount[] = users.map((user) => {
    const participant = participantMap.get(user.id);
    return {
      userId: user.id,
      email: user.email ?? "",
      displayName: profileMap.get(user.id)?.display_name ?? "",
      isAdmin: adminIds.has(user.id),
      isParticipant: Boolean(participant),
      isParticipantActive: participant?.is_active ?? false,
      contestantCode: participant?.contestant_code ?? null,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      createdAt: user.created_at,
    };
  });

  const params = await searchParams;
  const requestedFilter = params?.role;
  const search = params?.q?.trim() ?? "";
  const requestedStatus = params?.status;
  const filterValue: FilterOption = filterOptions.some((option) => option.id === requestedFilter)
    ? (requestedFilter as FilterOption)
    : "all";
  const visibleAccounts = accounts.filter((account) => {
    const matchesGroup = filterValue === "all" || category(account) === filterValue;
    const haystack = `${account.displayName} ${account.email} ${account.contestantCode ?? ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesStatus = requestedStatus !== "active" && requestedStatus !== "inactive"
      || (requestedStatus === "active" && account.isParticipant && account.isParticipantActive)
      || (requestedStatus === "inactive" && account.isParticipant && !account.isParticipantActive);
    return matchesGroup && matchesSearch && matchesStatus;
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Olympia</p>
          <h1 className="text-3xl font-semibold tracking-tight">Thí sinh &amp; tài khoản</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tìm nhanh theo tên, email hoặc mã thí sinh; chỉnh sửa bằng chức năng hiện có.</p>
        </div>
        <CreateAccountDialog />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-base">Tổng tài khoản</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{accounts.length}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Olympia Admin</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{accounts.filter((account) => account.isAdmin).length}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Tài khoản thi</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{accounts.filter((account) => account.isParticipant).length}</p></CardContent></Card>
      </div>

      <Card className="border-dashed">
        <CardHeader><CardTitle className="text-base">Lọc theo nhóm</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="flex flex-col gap-2 sm:flex-row">
            <Input name="q" defaultValue={search} placeholder="Tìm tên, email hoặc mã thí sinh..." />
            {filterValue !== "all" ? <input type="hidden" name="role" value={filterValue} /> : null}
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Tìm</button>
            {search || requestedStatus ? <Link href="/olympia/admin/accounts" className="rounded-md border px-4 py-2 text-center text-sm">Xóa lọc</Link> : null}
          </form>
          <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => (
            <Link
              key={option.id}
              href={option.id === "all" ? "/olympia/admin/accounts" : `/olympia/admin/accounts?role=${option.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                filterValue === option.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-muted-foreground hover:border-slate-400"
              )}
            >
              {option.label}
            </Link>
          ))}
          <Link href={`/olympia/admin/accounts?${filterValue !== "all" ? `role=${filterValue}&` : ""}status=active`} className={cn("rounded-full border px-3 py-1 text-sm", requestedStatus === "active" ? "border-green-600 bg-green-50 text-green-700" : "text-muted-foreground")}>Đang hoạt động</Link>
          <Link href={`/olympia/admin/accounts?${filterValue !== "all" ? `role=${filterValue}&` : ""}status=inactive`} className={cn("rounded-full border px-3 py-1 text-sm", requestedStatus === "inactive" ? "border-amber-600 bg-amber-50 text-amber-700" : "text-muted-foreground")}>Tạm khóa</Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Danh sách tài khoản</CardTitle>
          <p className="text-xs text-muted-foreground">{visibleAccounts.length} tài khoản hiển thị · dữ liệu trực tiếp từ Supabase Auth và schema Olympia.</p>
        </CardHeader>
        <Separator />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email / tên</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Thí sinh</TableHead>
                <TableHead>Email xác nhận</TableHead>
                <TableHead>Ngày tạo</TableHead>
                <TableHead>Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAccounts.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Không tìm thấy tài khoản phù hợp.</TableCell></TableRow>
              ) : null}
              {visibleAccounts.map((account) => (
                <TableRow key={account.userId}>
                  <TableCell>
                    <div className="font-medium">{account.displayName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{account.email}</div>
                  </TableCell>
                  <TableCell><Badge variant={account.isAdmin ? "default" : "secondary"}>{account.isAdmin ? "Admin" : "—"}</Badge></TableCell>
                  <TableCell>
                    {account.isParticipant ? (
                      <div><Badge variant="secondary">{account.isParticipantActive ? "Đang hoạt động" : "Tạm khóa"}</Badge><div className="mt-1 font-mono text-xs">{account.contestantCode ?? "—"}</div></div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{account.emailConfirmedAt ? dateFormatter.format(new Date(account.emailConfirmedAt)) : "Chưa xác nhận"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{dateFormatter.format(new Date(account.createdAt))}</TableCell>
                  <TableCell><EditAccountDialog account={account} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
