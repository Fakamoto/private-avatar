import { CourseConfig } from "@/app/components/course-config"

interface CourseConfigPageProps {
  params: {
    id: string
  }
}

export default function CourseConfigPage({ params }: CourseConfigPageProps) {
  return (
    <main className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Course Config</h1>
      <CourseConfig courseId={params.id} />
    </main>
  )
}

