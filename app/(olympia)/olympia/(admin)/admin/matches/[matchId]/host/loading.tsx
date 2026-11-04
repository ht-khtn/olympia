
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function HostConsoleLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32 bg-slate-200 dark:bg-slate-700" />
        <Skeleton className="h-8 w-64 bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-8 w-32 bg-slate-200 dark:bg-slate-700" />
        <Skeleton className="h-8 w-32 bg-slate-200 dark:bg-slate-700" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-40 bg-slate-200 dark:bg-slate-700" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48 bg-slate-200 dark:bg-slate-700" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
        </CardContent>
      </Card>
    </div>
  )
}
