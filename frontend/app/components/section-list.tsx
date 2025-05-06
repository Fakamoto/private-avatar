"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Save, FileDown, Pencil, Settings } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { SlideEditor } from "./slide-editor"
import { useLanguage } from "@/app/context/language-context"
import { MarkdownContent } from "@/app/components/markdown-content"

// Configure axios to use the API base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

interface Section {
  id: number
  title: string | null
  content: string | null
  short_description: string
  style: string
  instructions: string
  duration_minutes?: number
  lesson_id: number
  slide?: {
    id: number
    title: string
    bullet_points: string
    additional_text: string | null
    background: string
    preset: string
  }
}

interface Lesson {
  id: number
  order: number
  title: string
  sections: Section[]
}

interface SectionListProps {
  lessonId: number
}

export function SectionList({ lessonId }: SectionListProps) {
  const { t } = useLanguage()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [creatingSlide, setCreatingSlide] = useState<number | null>(null)
  const [downloadingSlide, setDownloadingSlide] = useState<number | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Record<number, string | null>>({})
  const [formData, setFormData] = useState<Record<number, Section>>({})
  const [editingSlide, setEditingSlide] = useState<number | null>(null)
  const router = useRouter()

  const fetchSections = useCallback(async () => {
    if (isNaN(lessonId)) {
      setError("Invalid lesson ID")
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      console.log(`Fetching lesson data from: ${API_BASE_URL}/lessons/${lessonId}`)
      const response = await fetch(`${API_BASE_URL}/lessons/${lessonId}`)

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      if (!data) {
        throw new Error("Invalid response format")
      }

      setLesson(data)
      setSections(data.sections || [])

      const initialFormData: Record<number, Section> = {}
      data.sections?.forEach((section: Section) => {
        initialFormData[section.id] = {
          ...section,
          title: section.title || "",
          content: section.content || "",
          short_description: section.short_description || "",
          style: section.style || "",
          instructions: section.instructions || "",
        }
      })
      setFormData(initialFormData)
    } catch (error) {
      console.error("Error fetching lesson data:", error)
      if (error instanceof Error) {
        setError(`Failed to fetch lesson data: ${error.message}`)
      } else {
        setError("Failed to fetch lesson data. Please try again.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [lessonId])

  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  const handleInputChange = (sectionId: number, field: keyof Section, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        [field]: field === "duration_minutes" ? Number(value) : value,
      },
    }))
  }

  const updateSection = async (sectionId: number) => {
    setSaving(sectionId)
    setSectionErrors((prev) => ({ ...prev, [sectionId]: null }))
    try {
      const sectionData = {
        ...formData[sectionId],
        title: formData[sectionId].title || null,
        content: formData[sectionId].content || null,
      }

      const response = await fetch(`${API_BASE_URL}/sections/${sectionId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sectionData),
      })

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      await fetchSections()
      toast.success("Section updated successfully")
    } catch (error) {
      console.error("Error updating section:", error)
      if (error instanceof Error) {
        setSectionErrors((prev) => ({
          ...prev,
          [sectionId]: `Failed to update section: ${error.message}`,
        }))
      } else {
        setSectionErrors((prev) => ({
          ...prev,
          [sectionId]: "An unexpected error occurred while updating the section.",
        }))
      }
    } finally {
      setSaving(null)
    }
  }

  const createSlide = async (sectionId: number) => {
    console.log(`Starting slide creation for section ${sectionId}`)
    setCreatingSlide(sectionId)
    try {
      // Refresh sections before creating slide
      await fetchSections()

      // Check if the section still exists
      const section = sections.find((s) => s.id === sectionId)
      if (!section) {
        throw new Error(`Section with ID ${sectionId} not found`)
      }

      console.log("Current sections:", sections)
      console.log("Attempting to create slide for section:", sectionId)

      console.log(`Sending POST request to create slide for section ${sectionId}`)
      const response = await fetch(`${API_BASE_URL}/sections/${sectionId}/slides`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log(`Slide creation response:`, data)

      // Wait a moment to ensure the slide is fully processed
      await new Promise((resolve) => setTimeout(resolve, 5000))

      console.log(`Fetching updated sections after slide creation`)
      await fetchSections()
      console.log(`Sections updated after slide creation`)

      toast.success("Slide created successfully")

      // Legacy slide options removed

      // Add a small delay before removing the loading state
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error) {
      console.error(`Error creating slide for section ${sectionId}:`, error)
      if (error instanceof Error) {
        if (error.message.includes("404")) {
          toast.error(`Section not found. Please refresh the page and try again.`)
        } else {
          toast.error(`Failed to create slide: ${error.message}`)
        }
      } else {
        toast.error("Failed to create slide. Please try again.")
      }
    } finally {
      console.log(`Finished slide creation process for section ${sectionId}`)
      setCreatingSlide(null)
    }
  }

  const downloadSlide = async (sectionId: number) => {
    console.log(`Starting slide download process for section ${sectionId}`)
    setDownloadingSlide(sectionId)
    try {
      // First, check if the slide exists
      const section = sections.find((s) => s.id === sectionId)
      if (!section) {
        throw new Error(`Section with ID ${sectionId} not found`)
      }

      console.log(`Section found:`, {
        id: section.id,
        title: section.title,
        hasSlide: !!section.slide,
      })

      // Create the slide if it doesn't exist
      if (!section.slide) {
        console.log(`Slide doesn't exist. Creating slide for section ${sectionId}`)
        await createSlide(sectionId)
        // Wait a moment to ensure the slide is processed
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // Refresh sections to get the updated slide info
        await fetchSections()
        console.log(`Sections refreshed after slide creation`)
      }

      // Now attempt to download the slide
      console.log(`Sending GET request to download slide for section ${sectionId}`)

      // Use the section's slide endpoint directly instead of the lesson endpoint
      const response = await fetch(`${API_BASE_URL}/sections/${sectionId}/slides/pptx`)

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      console.log(`Slide download response status:`, response.status)

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", `slide_${sectionId}.pptx`)
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      link.remove()
      console.log(`Slide download completed and file save initiated`)
      toast.success("Slide downloaded successfully")
    } catch (error) {
      console.error(`Error in slide download process for section ${sectionId}:`, error)
      if (error instanceof Error) {
        toast.error(`Failed to download slide: ${error.message}`)
      } else {
        toast.error("Failed to download slide. Please try again later.")
      }
    } finally {
      console.log(`Finished slide download process for section ${sectionId}`)
      setDownloadingSlide(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-red-500 text-center">
        <p>{error}</p>
        <Button onClick={fetchSections} className="mt-4">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Button onClick={() => router.back()} variant="outline">
          {t("sectionList.backToLessons")}
        </Button>
        <h1 className="text-2xl font-bold">{t("sectionList.lessonTitle", { order: lesson?.order || 1 })}</h1>
      </div>
      {sections.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          <p>{t("sectionList.noSections")}</p>
        </div>
      ) : (
        sections.map((section) => (
          <Card key={section.id} className="mb-6">
            <CardHeader>
              <CardTitle>
                <Input
                  value={formData[section.id]?.title ?? ""}
                  onChange={(e) => handleInputChange(section.id, "title", e.target.value)}
                  className="text-xl font-medium"
                  placeholder={t("sectionList.enterSectionTitle")}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("sectionList.content")}</label>
                <Textarea
                  value={formData[section.id]?.content ?? ""}
                  onChange={(e) => handleInputChange(section.id, "content", e.target.value)}
                  rows={6}
                  placeholder={t("sectionList.enterSectionContent")}
                  className="w-full"
                />

                {/* Preview content with MarkdownContent */}
                {formData[section.id]?.content && (
                  <div className="mt-4 border rounded-md p-4">
                    <h4 className="text-sm font-medium mb-2">{t("sectionList.contentPreview")}</h4>
                    <MarkdownContent
                      content={formData[section.id]?.content || ""}
                      className="prose-sm max-h-[300px] overflow-y-auto"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("sectionList.description")}</label>
                <Textarea
                  value={formData[section.id]?.short_description || ""}
                  onChange={(e) => handleInputChange(section.id, "short_description", e.target.value)}
                  rows={3}
                  placeholder={t("sectionList.shortDescription")}
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("sectionList.duration")}</label>
                  <Input
                    type="number"
                    min="1"
                    value={formData[section.id]?.duration_minutes || ""}
                    onChange={(e) => handleInputChange(section.id, "duration_minutes", Number(e.target.value))}
                    placeholder={t("sectionList.durationPlaceholder")}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("sectionList.style")}</label>
                  <Textarea
                    value={formData[section.id]?.style || ""}
                    onChange={(e) => handleInputChange(section.id, "style", e.target.value)}
                    rows={4}
                    placeholder={t("sectionList.stylePlaceholder")}
                    className="w-full resize-y min-h-[100px]"
                  />
                  <p className="text-sm text-muted-foreground mt-1">{t("sectionList.styleDescription")}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("sectionList.instructions")}</label>
                <Textarea
                  value={formData[section.id]?.instructions || ""}
                  onChange={(e) => handleInputChange(section.id, "instructions", e.target.value)}
                  rows={3}
                  placeholder={t("sectionList.specialInstructions")}
                  className="w-full"
                />
              </div>
              <div className="flex justify-between items-center">
                <Button onClick={() => updateSection(section.id)} disabled={saving === section.id} className="gap-2">
                  {saving === section.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {t("sectionList.saveChanges")}
                </Button>
                <div className="space-x-2">
                  {section.slide && section.slide.id ? (
                    <>
                      <Button
                        disabled
                        className="gap-2 cursor-not-allowed opacity-50"
                      >
                        <Settings className="h-4 w-4" />
                        Slide Settings (legacy)
                      </Button>
                      <Button onClick={() => setEditingSlide(section.id)} className="gap-2">
                        <Pencil className="h-4 w-4" />
                        {t("sectionList.editSlide")}
                      </Button>
                      <Button
                        onClick={() => downloadSlide(section.id)}
                        disabled={downloadingSlide === section.id}
                        className="gap-2"
                      >
                        {downloadingSlide === section.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileDown className="h-4 w-4" />
                        )}
                        {downloadingSlide === section.id ? "Downloading..." : t("sectionList.downloadSlide")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => createSlide(section.id)}
                      disabled={creatingSlide === section.id}
                      className="gap-2 min-w-[140px]" // Add min-width to prevent button size changes
                    >
                      {creatingSlide === section.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Pencil className="h-4 w-4" />
                          {t("sectionList.createSlide")}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {sectionErrors[section.id] && (
                <Alert variant="destructive">
                  <AlertDescription>{sectionErrors[section.id]}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {editingSlide !== null && (
        <SlideEditor
          sectionId={editingSlide}
          onClose={() => {
            setEditingSlide(null)
            fetchSections()
          }}
        />
      )}
    </div>
  )
}
