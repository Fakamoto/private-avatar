import { CompleteCourse } from "@/app/components/complete-course"

interface CourseViewPageProps {
  params: Promise<{ id: string }>
}

export default async function CourseViewPage({ params }: CourseViewPageProps) {
  const { id } = await params

  return (
    <main className="container mx-auto p-4">
      <CompleteCourse courseId={id} />
    </main>
  )
}
