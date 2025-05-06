"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Loader2, BookOpen } from "lucide-react"
import { toast } from "sonner"
import { useLanguage } from "@/app/context/language-context"

export function CreateCourse() {
  const { t } = useLanguage()
  const [courseName, setCourseName] = useState("")
  const [courseDescription, setCourseDescription] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!courseName.trim()) {
      toast.error(t("createCourse.enterCourseName"))
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: courseName,
          description: courseDescription,
        }),
      })

      if (!response.ok) {
        throw new Error(t("createCourse.failedToCreate"))
      }

      const newCourse = await response.json()
      toast.success(t("createCourse.courseCreated"))
      router.push(`/courses/${newCourse.id}/config`)
    } catch (error) {
      console.error("Error creating course:", error)
      toast.error(t("createCourse.errorCreating"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("createCourse.title")}</h1>
        <p className="text-muted-foreground mt-2">{t("createCourse.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-xl font-semibold">
            <BookOpen className="mr-2 h-5 w-5" />
            {t("createCourse.courseDetails")}
          </CardTitle>
          <CardDescription>{t("createCourse.provideInfo")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="courseName">{t("createCourse.courseName")}</Label>
              <Input
                id="courseName"
                type="text"
                placeholder={t("createCourse.courseNamePlaceholder")}
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                required
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="courseDescription">{t("createCourse.courseDescription")}</Label>
              <Textarea
                id="courseDescription"
                placeholder={t("createCourse.courseDescriptionPlaceholder")}
                value={courseDescription}
                onChange={(e) => setCourseDescription(e.target.value)}
                rows={4}
                className="w-full resize-vertical min-h-[100px]"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("createCourse.creatingCourse")}
                </>
              ) : (
                t("createCourse.createCourse")
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

