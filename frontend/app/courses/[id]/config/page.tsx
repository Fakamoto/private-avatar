import { CourseConfig } from "@/app/components/course-config"
import { Suspense } from "react"
import { Loader2 } from "lucide-react"

interface CourseConfigPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function CourseConfigPage({ params }: CourseConfigPageProps) {
  const { id } = await params

  return (
    <main className="container mx-auto p-4">
      <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin" />}>
        <CourseConfig courseId={id} />
      </Suspense>
    </main>
  )
}

