"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, Plus, Trash2, Eye, Settings, BookOpen } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useLanguage } from "@/app/context/language-context"

interface Course {
  id: number
  title?: string
  name?: string
  description?: string
  lessons?: { id: number }[]
}

export function CourseList() {
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [courseToDelete, setCourseToDelete] = useState<number | null>(null)
  const router = useRouter()
  const { t } = useLanguage()

  const fetchCourses = async () => {
    try {
      const res = await fetch("/api/courses")
      if (!res.ok) {
        throw new Error(`Error! status: ${res.status}`)
      }
      const data = await res.json()
      setCourses(data)
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError("An unknown error occurred")
      }
    } finally {
      setIsLoading(false)
    }
  }

  const deleteCourse = async (id: number) => {
    try {
      const res = await fetch(`/api/courses/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        throw new Error(`Error! status: ${res.status}`)
      }
      await fetchCourses()
      toast.success(t("courseList.deleteSuccess"))
      setCourseToDelete(null)
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error("An unknown error occurred while deleting the course")
      }
    }
  }

  useEffect(() => {
    fetchCourses()
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-5xl p-4 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("courseList.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("courseList.subtitle")}</p>
        </div>
        <Link href="/create-course">
          <Button className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" /> {t("courseList.createButton")}
          </Button>
        </Link>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{t("courseList.error")}</AlertDescription>
        </Alert>
      ) : courses.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-8 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{t("courseList.noCourses")}</h3>
          <p className="text-muted-foreground mt-2">{t("courseList.getStarted")}</p>
          <Link href="/create-course" className="mt-4">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> {t("courseList.createButton")}
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="line-clamp-1 text-xl">{course.title || course.name}</CardTitle>
                {course.description && <CardDescription className="line-clamp-2">{course.description}</CardDescription>}
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <BookOpen className="mr-2 h-4 w-4" />
                    {course.lessons?.length || 0} {t("courseList.lessons")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => router.push(`/courses/${course.id}/complete`)}
                    >
                      <Eye className="mr-2 h-4 w-4" /> {t("courseList.view")}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => router.push(`/courses/${course.id}/config`)}
                    >
                      <Settings className="mr-2 h-4 w-4" /> {t("courseList.configure")}
                    </Button>
                    <Button variant="destructive" size="icon" onClick={() => setCourseToDelete(course.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={courseToDelete !== null} onOpenChange={() => setCourseToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("courseList.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("courseList.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("courseList.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => courseToDelete && deleteCourse(courseToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("courseList.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

