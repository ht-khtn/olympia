import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MatchDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40 bg-slate-200 dark:bg-slate-700" />
        <Skeleton className="h-10 w-80 bg-slate-200 dark:bg-slate-700" />
        <div className="flex gap-3">
          <Skeleton className="h-5 w-40 bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-5 w-40 bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-48 bg-slate-200 dark:bg-slate-700" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-700" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-48 bg-slate-200 dark:bg-slate-700" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-32 bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-4 w-32 bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-4 w-32 bg-slate-200 dark:bg-slate-700" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-40 bg-slate-200 dark:bg-slate-700" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-8 w-full bg-slate-200 dark:bg-slate-700" />
        </CardContent>
      </Card>
    </div>
  )
}
