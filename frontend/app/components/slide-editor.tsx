"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Save, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { useLanguage } from "@/app/context/language-context"

// Configure API base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

interface Slide {
  id: number
  title: string
  bullet_points: string
  additional_text: string | null
  background: string
  preset: string
}

interface SlideEditorProps {
  sectionId: number
  onClose: () => void
}

export function SlideEditor({ sectionId, onClose }: SlideEditorProps) {
  const { t } = useLanguage()
  const [slide, setSlide] = useState<Slide | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSlide = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/sections/${sectionId}/slides`)

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setSlide(data)
    } catch (error) {
      console.error("Error fetching slide:", error)
      if (error instanceof Error) {
        setError(`Failed to fetch slide: ${error.message}`)
      } else {
        setError("Failed to fetch slide. Please try again.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [sectionId])

  useEffect(() => {
    fetchSlide()
  }, [fetchSlide])

  const handleInputChange = (field: keyof Slide, value: string) => {
    if (!slide) return
    setSlide({ ...slide, [field]: value })
  }

  const saveSlide = async () => {
    if (!slide) return

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/sections/${sectionId}/slides`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(slide),
      })

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`)
      }

      toast.success("Slide updated successfully")
      onClose()
    } catch (error) {
      console.error("Error updating slide:", error)
      if (error instanceof Error) {
        setError(`Failed to update slide: ${error.message}`)
      } else {
        setError("Failed to update slide. Please try again.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("slideEditor.loading")}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex justify-center p-6">
            <Loader2 className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-2xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("slideEditor.error")}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button onClick={fetchSlide}>{t("slideEditor.retry")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!slide) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-2xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("slideEditor.noSlide")}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground">{t("slideEditor.noSlideFound")}</p>
            <div className="flex justify-end mt-4">
              <Button onClick={onClose}>{t("slideEditor.close")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("slideEditor.editSlide")}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t("slideEditor.slideTitle")}</label>
            <Input
              value={slide.title}
              onChange={(e) => handleInputChange("title", e.target.value)}
              placeholder={t("slideEditor.slideTitlePlaceholder")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("slideEditor.bulletPoints")}</label>
            <Textarea
              value={slide.bullet_points}
              onChange={(e) => handleInputChange("bullet_points", e.target.value)}
              rows={6}
              placeholder={t("slideEditor.bulletPointsPlaceholder")}
              className="font-mono"
            />
            <p className="text-sm text-muted-foreground mt-1">{t("slideEditor.bulletPointsHelp")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("slideEditor.additionalText")}</label>
            <Textarea
              value={slide.additional_text || ""}
              onChange={(e) => handleInputChange("additional_text", e.target.value)}
              rows={4}
              placeholder={t("slideEditor.additionalTextPlaceholder")}
            />
            <p className="text-sm text-muted-foreground mt-1">{t("slideEditor.additionalTextHelp")}</p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={onClose}>
              {t("slideEditor.cancel")}
            </Button>
            <Button onClick={saveSlide} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("slideEditor.saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
