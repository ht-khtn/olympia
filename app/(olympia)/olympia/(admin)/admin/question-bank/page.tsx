import { UploadQuestionSetDialog } from '@/components/olympia/admin/question-bank/UploadQuestionSetDialog'
import { ViewQuestionSetDialog } from '@/components/olympia/admin/question-bank/ViewQuestionSetDialog'
import { DeleteQuestionSetButton } from '@/components/olympia/admin/question-bank/DeleteQuestionSetButton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { requireOlympiaAdminContext } from '@/lib/olympia/olympia-auth'
import getOlympiaAdminClient from '@/lib/olympia/olympia-admin-client'

type QuestionRow = {
  id: string
  code: string
  category: string | null
  question_text: string
  answer_text: string
  note: string | null
  created_at: string
  question_sets?: { name: string } | { name: string }[] | null
}

type QuestionSetRow = {
  id: string
  name: string
  item_count: number
  original_filename: string | null
  created_at: string
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' })
const formatDate = (value: string) => dateFormatter.format(new Date(value))

async function fetchQuestionBank(search: string, category: string) {
  const olympia = getOlympiaAdminClient().schema('olympia')
  const { data, error, count } = await olympia
    .from('question_set_items')
    .select('id, code, category, question_text, answer_text, note, created_at, question_set_id, question_sets(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  const filteredQuestions = (data ?? []).filter((question) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || [question.code, question.question_text, question.answer_text]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(term))
    const matchesCategory = !category || (question.category ?? 'uncategorized') === category
    return matchesSearch && matchesCategory
  })

  return {
    total: count ?? data?.length ?? 0,
    questions: filteredQuestions,
  }
}

async function fetchQuestionSets(search: string) {
  {
    const olympia = getOlympiaAdminClient().schema('olympia')
    const { data, error } = await olympia
      .from('question_sets')
      .select('id, name, item_count, original_filename, created_at')
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error
    const term = search.trim().toLowerCase()
    return (data ?? []).filter((set) => !term || set.name.toLowerCase().includes(term) || (set.original_filename ?? '').toLowerCase().includes(term))
  }
}

function CategoryBadges({ questions }: { questions: QuestionRow[] }) {
  const counts = questions.reduce<Record<string, number>>((acc, q) => {
    const key = q.category ?? 'Chưa phân loại'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const entries = Object.entries(counts)
  if (entries.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([cat, value]) => (
        <Badge key={cat} variant="secondary">
          {cat}: {value}
        </Badge>
      ))}
    </div>
  )
}

export default async function OlympiaQuestionBankPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; category?: string }>
}) {
  await requireOlympiaAdminContext()
  const params = await searchParams
  const search = params?.q ?? ''
  const category = params?.category ?? ''
  const [{ total, questions }, questionSets] = await Promise.all([fetchQuestionBank(search, category), fetchQuestionSets(search)])
  const categories = Array.from(new Set(questions.map((question) => question.category ?? 'uncategorized'))).sort()

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Ngân hàng câu hỏi</h2>
          <p className="text-sm text-muted-foreground">Quản lý bộ đề V4(1), xem nhanh nội dung và chuẩn bị cho từng trận.</p>
        </div>
        <div className="flex gap-2">
          <UploadQuestionSetDialog />
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <Input name="q" defaultValue={search} placeholder="Tìm theo tên bộ đề, mã hoặc nội dung câu hỏi..." />
            <select name="category" defaultValue={category} className="h-10 rounded-md border bg-background px-3 text-sm">
              <option value="">Tất cả chuyên mục</option>
              {categories.map((value) => (
                <option key={value} value={value}>{value === 'uncategorized' ? 'Chưa phân loại' : value}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Lọc</button>
              {search || category ? <a href="/olympia/admin/question-bank" className="rounded-md border px-4 py-2 text-sm">Xóa lọc</a> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tổng quan</CardTitle>
          <CardDescription>
            {total} câu hỏi được ghi nhận trong bảng <span className="font-medium text-slate-900">olympia.question_set_items</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bộ đếm theo chuyên mục dựa trên 50 bản ghi mới nhất. Sau khi có bộ lọc, thông tin thống kê sẽ cập nhật theo
            điều kiện.
          </p>
          <CategoryBadges questions={questions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bộ đề đã tải lên</CardTitle>
          <CardDescription>Danh sách tối đa 30 bộ đề mới nhất.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {questionSets.length === 0 ? (
            <Alert>
              <AlertTitle>Chưa có bộ đề</AlertTitle>
              <AlertDescription>Tải file .xlsx để tạo bộ đề cố định, không chỉnh sửa trực tiếp.</AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên bộ đề</TableHead>
                  <TableHead>Số câu</TableHead>
                  <TableHead>File gốc</TableHead>
                  <TableHead>Import lúc</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questionSets.map((set: QuestionSetRow) => (
                  <TableRow key={set.id}>
                    <TableCell className="font-medium">{set.name}</TableCell>
                    <TableCell>{set.item_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{set.original_filename ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(set.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={set.item_count > 0 ? 'default' : 'secondary'}>
                        {set.item_count > 0 ? 'Sẵn sàng' : 'Chưa có câu hỏi'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <ViewQuestionSetDialog
                          questionSetId={set.id}
                          questionSetName={set.name}
                          itemCount={set.item_count}
                        />
                        <DeleteQuestionSetButton questionSetId={set.id} questionSetName={set.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <Alert>
          <AlertTitle>Chưa có dữ liệu</AlertTitle>
          <AlertDescription>
            Tải bộ đề hoặc tạo câu hỏi mới để kiểm thử tính năng đồng bộ.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{search || category ? 'Kết quả câu hỏi' : '50 câu hỏi gần nhất'}</CardTitle>
            <CardDescription>{questions.length} câu hỏi đang hiển thị trong phạm vi dữ liệu tải về.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Chuyên mục</TableHead>
                  <TableHead>Nội dung</TableHead>
                  <TableHead>Đáp án</TableHead>
                  <TableHead>Bộ đề</TableHead>
                  <TableHead>Tạo lúc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((question) => (
                  <TableRow key={question.id}>
                    <TableCell className="font-mono text-xs">{question.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{question.category ?? 'Chưa phân loại'}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xl text-sm">
                      <p className="line-clamp-3 text-muted-foreground">{question.question_text}</p>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-slate-900">{question.answer_text}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Array.isArray(question.question_sets)
                        ? question.question_sets[0]?.name ?? '—'
                        : (question.question_sets as Record<string, string> | null)?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(question.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
