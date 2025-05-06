import { LessonList } from "@/app/components/lessons-list"
import { Suspense } from "react"
import { Loader2 } from "lucide-react"
import { InternationalizedTitle } from "@/app/components/internationalized-title"

interface LessonManagementPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function LessonManagementPage({ params }: LessonManagementPageProps) {
  const { id } = await params

  return (
    <main className="container mx-auto p-4">
      <InternationalizedTitle translationKey="lessonManagement.title" />
      <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin" />}>
        <LessonList courseId={Number.parseInt(id, 10)} />
      </Suspense>
    </main>
  )
}

