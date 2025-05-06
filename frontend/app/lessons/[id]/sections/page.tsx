import { SectionList } from "@/app/components/section-list"
import { InternationalizedTitle } from "@/app/components/internationalized-title"

interface SectionManagementPageProps {
  params: Promise<{ id: string }>
}

export default async function SectionManagementPage({ params }: SectionManagementPageProps) {
  const { id } = await params

  return (
    <main className="container mx-auto p-4">
      <InternationalizedTitle translationKey="sectionManagement.title" />
      <SectionList lessonId={Number.parseInt(id, 10)} />
    </main>
  )
}

