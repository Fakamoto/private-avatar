"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Loader2, Upload, Trash2, PenTool, FastForward } from "lucide-react"
import { toast } from "sonner"
import { useLanguage } from "@/app/context/language-context"

// Configure axios to use the API base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

interface Document {
  id: number
  name: string
}

interface CourseConfigProps {
  courseId: string
}

export function CourseConfig({ courseId }: CourseConfigProps) {
  const router = useRouter()
  const { t } = useLanguage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [language, setLanguage] = useState("ES")
  const [coursePrompt, setCoursePrompt] = useState("")
  const [durationMinutes, setDurationMinutes] = useState<string>("60")
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDeleting, setIsDeleting] = useState<number | null>(null)
  const [isGeneratingFull, setIsGeneratingFull] = useState(false)

  useEffect(() => {
    const fetchDocuments = async () => {
      setIsLoading(true)
      try {
        // Use direct URL without axios defaults
        const response = await fetch(`${API_BASE_URL}/courses/${courseId}/documents`)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        setDocuments(data)
      } catch (error) {
        console.error("Error fetching documents:", error)

        // If there's an error, set documents to empty array to allow uploads
        setDocuments([])

        if (error instanceof Error) {
          toast.error(`Error fetching documents: ${error.message}`)
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchDocuments()
  }, [courseId])

  const handleUploadDocument = async (files: FileList) => {
    setIsUploading(true)

    try {
      const uploadedDocs = [...documents]

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const formData = new FormData()
        formData.append("file", file)

        try {
          const response = await fetch(`${API_BASE_URL}/courses/${courseId}/documents`, {
            method: "POST",
            body: formData,
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data = await response.json()
          uploadedDocs.push(data)
        } catch (error) {
          console.error(`Error uploading document ${file.name}:`, error)
          toast.error(`${t("courseConfig.documentUploadError")}: ${file.name}`)
        }
      }

      setDocuments(uploadedDocs)
      toast.success(t("courseConfig.documentsUploadSuccess"))
    } catch (error) {
      console.error("Error in upload process:", error)
      toast.error(t("courseConfig.documentUploadError"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeleteDocument = async (documentId: number) => {
    try {
      setIsDeleting(documentId)

      const response = await fetch(`${API_BASE_URL}/courses/${courseId}/documents/${documentId}`, {
        method: "DELETE",
      })

      console.log(`Frontend: API response status:`, response.status)

      if (response.ok) {
        console.log("Frontend: Document deleted successfully")
        setDocuments(documents.filter((doc) => doc.id !== documentId))
        toast.success(t("courseConfig.documentDeleteSuccess"))
      } else {
        console.error(`Frontend: API error: ${response.status}`)
        toast.error(t("courseConfig.documentDeleteError"))
      }
    } catch (error) {
      console.error("Frontend: Main error in handleDeleteDocument:", error)
      toast.error(t("courseConfig.documentDeleteError"))
    } finally {
      setIsDeleting(null)
    }
  }

  const handleGenerateCoursePlan = async () => {
    if (!coursePrompt || !language || !durationMinutes) {
      toast.error(t("courseConfig.fillAllFields"))
      return
    }

    setIsGenerating(true)
    try {
      console.log("Sending request to:", `${API_BASE_URL}/courses/${courseId}/plan`)

      const response = await fetch(`${API_BASE_URL}/courses/${courseId}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: coursePrompt,
          language,
          duration_minutes: Number.parseInt(durationMinutes, 10),
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      toast.success(t("courseConfig.coursePlanGenerateSuccess"))
      router.push(`/courses/${courseId}/lessons`)
    } catch (error) {
      console.error("Error generating course plan:", error)
      toast.error(t("courseConfig.coursePlanGenerateError"))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateFullCourse = async () => {
    if (!coursePrompt || !language || !durationMinutes) {
      toast.error(t("courseConfig.fillAllFields"))
      return
    }

    setIsGeneratingFull(true)
    try {
      console.log("Sending request to:", `${API_BASE_URL}/courses/${courseId}/generate-full`)

      const response = await fetch(`${API_BASE_URL}/courses/${courseId}/generate-full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: coursePrompt,
          language,
          duration_minutes: Number.parseInt(durationMinutes, 10),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }))
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`)
      }

      // The backend endpoint now returns the initial task progress
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _taskProgress = await response.json() // Prefix with underscore
      toast.success(t("courseConfig.fullCourseGenerationStarted")) // Need new translation key

      router.push(`/courses/${courseId}/lessons`)
    } catch (error) {
      console.error("Error starting full course generation:", error)
      const errorMessage = error instanceof Error ? error.message : t("courseConfig.fullCourseGenerateError")
      toast.error(`${t("courseConfig.fullCourseGenerateError")}: ${errorMessage}`)
    } finally {
      setIsGeneratingFull(false)
    }
  }

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === "" || !isNaN(Number(value))) {
      setDurationMinutes(value)
    }
  }

  const handleDurationBlur = () => {
    if (durationMinutes === "") {
      setDurationMinutes("60")
    } else {
      const numValue = Number.parseInt(durationMinutes, 10)
      if (!isNaN(numValue)) {
        const roundedValue = Math.max(5, Math.round(numValue / 5) * 5)
        setDurationMinutes(roundedValue.toString())
      }
    }
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-8 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-bold">{t("courseConfig.title")}</CardTitle>
          <CardDescription>{t("courseConfig.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="language">{t("courseConfig.language")}</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger id="language">
                      <SelectValue placeholder={t("courseConfig.selectLanguage")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ES">{t("courseConfig.spanish")}</SelectItem>
                      <SelectItem value="EN">{t("courseConfig.english")}</SelectItem>
                      <SelectItem value="IT">{t("courseConfig.italian")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="durationMinutes">{t("courseConfig.duration")}</Label>
                  <Input
                    id="durationMinutes"
                    type="number"
                    min="5"
                    step="5"
                    value={durationMinutes}
                    onChange={handleDurationChange}
                    onBlur={handleDurationBlur}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="coursePrompt">{t("courseConfig.coursePrompt")}</Label>
                <Textarea
                  id="coursePrompt"
                  value={coursePrompt}
                  onChange={(e) => setCoursePrompt(e.target.value)}
                  rows={4}
                  placeholder={t("courseConfig.coursePromptPlaceholder")}
                  className="resize-y"
                />
                <p className="text-sm text-muted-foreground mt-2">{t("courseConfig.coursePromptTip")}</p>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">{t("courseConfig.documents")}</h3>
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    multiple
                    id="document-upload"
                    className="hidden"
                    onChange={(e) => e.target.files && handleUploadDocument(e.target.files)}
                  />
                  <Button
                    onClick={() => document.getElementById("document-upload")?.click()}
                    className="gap-2"
                    disabled={isUploading}
                  >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isUploading ? t("courseConfig.uploading") : t("courseConfig.uploadDocuments")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {documents.length > 0 ? (
                    documents.map((doc) => (
                      <div key={doc.id} className="flex justify-between items-center bg-muted p-3 rounded-md">
                        <span className="text-sm">{doc.name}</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteDocument(doc.id)}
                          disabled={isUploading || isGenerating || isDeleting !== null}
                        >
                          {isDeleting === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground">{t("courseConfig.noDocuments")}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Button
                  onClick={handleGenerateCoursePlan}
                  disabled={isGenerating || isGeneratingFull || isUploading || isLoading}
                  className="flex-1"
                  size="sm"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("courseConfig.generatingPlan")}
                    </>
                  ) : (
                    <>
                      {t("courseConfig.generatePlan")} <PenTool className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleGenerateFullCourse}
                  disabled={isGenerating || isGeneratingFull || isUploading || isLoading}
                  className="flex-1"
                  size="sm"
                >
                  {isGeneratingFull ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("courseConfig.generatingFullCourse")}
                    </>
                  ) : (
                    <>
                      {t("courseConfig.fastForward")} <FastForward className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
