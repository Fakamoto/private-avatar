import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MarkdownContent } from "@/app/components/markdown-content"

interface SectionPreviewProps {
  title: string
  content: string
}

export function SectionPreview({ title, content }: SectionPreviewProps) {
  // Limit content preview to first 200 characters
  const previewContent = content.length > 200 ? `${content.substring(0, 200)}...` : content

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <MarkdownContent content={previewContent} />
      </CardContent>
    </Card>
  )
}

