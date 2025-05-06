import { SectionList } from "@/app/components/section-list"

interface SectionManagementPageProps {
  params: Promise<{ id: string }>
}

export default async function SectionManagementPage({ params }: SectionManagementPageProps) {
  const { id } = await params

  return (
    <main className="container mx-auto p-4">
      <h1 className="flex justify-center text-3xl font-bold mb-6">Section Management</h1>
      <SectionList lessonId={Number.parseInt(id)} />
    </main>
  )
}