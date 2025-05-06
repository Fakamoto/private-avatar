"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import axios from "axios"
import { Button } from "@/components/ui/button"
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
  Play,
  Pencil,
  Eye,
  Save,
  X,
  ArrowLeft,
  FileDown,
  AlertTriangle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useLanguage } from "@/app/context/language-context"
import { useRouter } from "next/navigation"
import { useIsWorking } from "@/hooks/use-is-working"
import { LoadingModal } from "@/app/components/loading-modal"
import { MarkdownContent } from "@/app/components/markdown-content"
import { EnhancedErrorBoundary } from "@/app/components/enhanced-error-boundary"
import { useApiWithRetry } from "@/hooks/use-api-with-retry"
import { useDownloadProgress } from "@/hooks/use-download-progress"
import { DownloadProgress } from "@/app/components/download-progress"

// Configure axios to use the API base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

// Add this debug log at the top of the LessonList component
console.log("API_BASE_URL:", API_BASE_URL)

// Remove /api prefix from axios requests
axios.defaults.baseURL = API_BASE_URL

// Track last lessons fetch time and avoid duplicate requests
// const lastFetchTimeRef = useRef<number>(0) // Moved inside component

// Prevent multiple simultaneous fetches
// const isFetchingRef = useRef(false) // Moved inside component

// Use a ref to store the fetchLessons function to break circular dependencies
// const fetchLessonsRef = useRef<() => Promise<Lesson[]>>(async () => []) // Moved inside component

// Increase axios timeout since some operations (slides) can be slow
axios.defaults.timeout = 180000 // 3 minutes

interface Section {
  id: number
  title: string
  content: string
  short_description: string
  length?: string
  style?: string
  instructions?: string
  previous_section_context?: string
  next_section_context?: string
  duration_minutes: number
}

interface Lesson {
  id: number
  title: string
  prompt: string
  sections: Section[]
  duration_minutes: number
  courseTitle?: string
}

interface LessonListProps {
  courseId: number
}

export function LessonList({ courseId }: LessonListProps) {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [courseTitle, setCourseTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [openLessons, setOpenLessons] = useState<number[]>([])
  const [editingTitles, setEditingTitles] = useState<number[]>([])
  const [editingTitleValues, setEditingTitleValues] = useState<{ [key: number]: string }>({})
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [currentDownloadFilename, setCurrentDownloadFilename] = useState<string | undefined>()
  const [showReloadButton, setShowReloadButton] = useState(false)

  // Refs moved inside the component
  const lastFetchTimeRef = useRef<number>(0)
  const isFetchingRef = useRef(false)
  const fetchLessonsRef = useRef<() => Promise<Lesson[]>>(async () => [])

  // Detector de bucles infinitos
  const renderCountRef = useRef(0)
  useEffect(() => {
    renderCountRef.current += 1

    // Si hay demasiados renderizados en poco tiempo, mostrar el botón de recarga
    if (renderCountRef.current > 50) {
      setShowReloadButton(true)
      console.error("Posible bucle infinito detectado, mostrando botón de recarga")
    }

    // Resetear el contador después de 5 segundos
    const timeout = setTimeout(() => {
      renderCountRef.current = 0
    }, 5000)

    return () => clearTimeout(timeout)
  }, [])

  // Use our API with retry hook
  const api = useApiWithRetry({
    maxRetries: 3,
    retryDelay: 1000,
    onError: (error) => {
      console.error("API error in LessonList:", error)
      toast.error(`API error: ${error.message}`)
    },
  })

  // Use our download hook with progress
  const { isDownloading, progress, downloadFileWithProgress } = useDownloadProgress({
    onSuccess: (filename) => {
      console.log(`Successfully downloaded: ${filename}`)
      setCurrentDownloadFilename(undefined)
    },
    onError: (error) => {
      console.error("Download error:", error)
      setCurrentDownloadFilename(undefined)
    },
  })

  // Función para forzar una actualización del componente
  const forceUpdate = useCallback(() => {
    console.log("Forcing component update")
  }, [])

  // Ref to track if the *current* task completing was slide generation
  const completingTaskType = useRef<"slides" | "other" | null>(null)

  // Use our new isWorking hook
  const {
    isLoading: isTaskLoading,
    isWorking,
    taskMessage,
    startTask,
    startPolling,
    stopPolling,
    error: taskError,
  } = useIsWorking({
    courseId,
    onComplete: () => {
      console.log("[onComplete] Task marked as complete by useIsWorking hook.");
    },
    onError: (error) => {
      console.error("[onComplete] Error during minimal onComplete handler:", error)
    },
  })

  // State to track if backend confirms course slides exist
  const [doesCourseHaveSlides, setDoesCourseHaveSlides] = useState<boolean | null>(null)

  // Function to check slide status and update state
  const checkAndUpdateSlideStatus = useCallback(async () => {
    try {
      console.log("[checkAndUpdateSlideStatus] Checking course slide status...");
      const slideStatusResponse = await api.get<{ has_slides: boolean }>(`/courses/${courseId}/has-slides`);
      const hasSlides = slideStatusResponse?.data?.has_slides ?? false;
      console.log(`[checkAndUpdateSlideStatus] API /has-slides result: ${hasSlides}`);
      // Only update state if it's different to avoid unnecessary renders
      setDoesCourseHaveSlides(prev => {
        if (prev !== hasSlides) {
           console.log(`[checkAndUpdateSlideStatus] Updating state from ${prev} to ${hasSlides}`);
           return hasSlides;
        }
        console.log(`[checkAndUpdateSlideStatus] State already ${prev}, no update needed.`);
        return prev; 
      });
    } catch (err) {
      console.error("[checkAndUpdateSlideStatus] Failed to check slide status:", err);
      setDoesCourseHaveSlides(false); // Assume false on error
    }
  }, [courseId, api]);

  // New helper functions to check workflow states
  const hasGeneratedPlans = useCallback(() => {
    return lessons.length > 0 && lessons.every((lesson) => lesson.sections && lesson.sections.length > 0)
  }, [lessons])

  const hasWrittenContents = useCallback(() => {
    return (
      lessons.length > 0 &&
      lessons.every(
        (lesson) =>
          lesson.sections && lesson.sections.length > 0 && lesson.sections.every((section) => section.content),
      )
    )
  }, [lessons])

  // Helper function to check if a specific lesson has content
  const hasLessonContent = useCallback((lesson: Lesson) => {
    return (
      lesson.sections &&
      lesson.sections.length > 0 &&
      lesson.sections.every((section) => section.content && section.content.trim() !== "")
    )
  }, [])

  // Modify the fetchLessons function to include console logs
  const fetchLessons = useCallback(async () => {
    // Prevent excessive calls by checking the last fetch time
    const now = Date.now()
    if (now - lastFetchTimeRef.current < 5000 && !isFetchingRef.current) {
      // Only fetch every 5 seconds at most
      console.log("Throttling fetchLessons - too soon since last fetch")
      return lessons
    }

    // Prevent multiple simultaneous fetches
    if (isFetchingRef.current) {
      console.log("Already fetching lessons, skipping")
      return lessons
    }

    // Don't fetch if we're in the middle of a task
    if (isTaskLoading || isWorking) {
      console.log("Skipping fetchLessons - task in progress")
      return lessons
    }

    isFetchingRef.current = true
    lastFetchTimeRef.current = now

    console.log("Fetching lessons for course ID:", courseId)
    setIsLoading(true)
    setError(null)
    try {
      // Make sure we're using the correct URL format
      const response = await api.get<Lesson[]>(`/courses/${courseId}/lessons`)

      if (!response) {
        throw new Error("Failed to fetch lessons")
      }

      console.log("Lessons data received:", response.data)

      // Actualizar el estado con las nuevas lecciones
      setLessons(response.data)

      // Actualizar el título del curso
      if (response.data.length > 0 && response.data[0].courseTitle) {
        setCourseTitle(response.data[0].courseTitle)
      }

      // Filter lessons to only include those with content
      // const lessonsWithContent = response.data.filter((lesson) => hasLessonContent(lesson)) // Unused variable removed

      // No automatic slide existence check

      // If we have no lessons but we're not in a task, check if the course is working
      if (response.data.length === 0 && !isTaskLoading && !isWorking) {
        console.log("No lessons found, checking if course is working")
        try {
          console.log(`Checking if course ${courseId} is working`)
          const isCurrentlyWorking = await api.get<{ is_working: boolean }>(`/courses/${courseId}/is-working`)

          if (isCurrentlyWorking && isCurrentlyWorking.data.is_working) {
            console.log(`Course ${courseId} is working:`, isCurrentlyWorking.data.is_working)
            console.log("Course is working, starting polling")
            setLoadingMessage("Processing...")
            startPolling()
          }
        } catch (error) {
          console.error("Error checking if course is working:", error)
        }
      }

      // NO slide checks here
      
      // Forzar una actualización del componente
      forceUpdate()

      // Check if slides exist for the course
      if (response.data.length > 0) { // Only check if lessons exist
        try {
          console.log("[fetchLessons] Checking initial slide status...")
          const slideStatusResponse = await api.get<{ has_slides: boolean }>(`/courses/${courseId}/has-slides`)
          setDoesCourseHaveSlides(slideStatusResponse?.data?.has_slides ?? false)
          console.log("Initial slide status:", slideStatusResponse?.data?.has_slides);
        } catch (slideError) {
          console.error("Failed to fetch initial slide status:", slideError)
          setDoesCourseHaveSlides(false) // Assume false if check fails
        }
      } else {
         setDoesCourseHaveSlides(false) // No lessons means no slides
      }

      return response.data
    } catch (error) {
      console.error("Error fetching data:", error)
      setError("Failed to fetch lessons. Please try again.")
      return []
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [
    courseId,
    isTaskLoading,
    isWorking,
    api,
    lessons,
    forceUpdate,
    hasLessonContent,
  ])

  // Update the ref whenever fetchLessons changes
  useEffect(() => {
    fetchLessonsRef.current = fetchLessons
  }, [fetchLessons])

  // Update the useEffect to include fetchLessons in the dependency array
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Only fetch when the tab becomes visible and not in a task
        if (!isTaskLoading && !isWorking) {
          fetchLessons()
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Initial fetch - only if we haven't fetched recently
    const now = Date.now()
    if (now - lastFetchTimeRef.current > 5000) {
      fetchLessons()
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchLessons, isTaskLoading, isWorking])

  // Add a polling mechanism to check for updates
  useEffect(() => {
    // Only set up polling if not in a task
    if (isTaskLoading || isWorking) {
      return
    }

    // Set up a polling interval to check for updates
    const pollInterval = setInterval(() => {
      if (!isTaskLoading && !isWorking && !isFetchingRef.current) {
        console.log("Polling for updates...")
        fetchLessons()
      }
    }, 30000) // Poll every 30 seconds instead of 10

    return () => {
      clearInterval(pollInterval)
    }
  }, [fetchLessons, isTaskLoading, isWorking])

  const updateLessonPrompt = useCallback(
    async (lessonId: number, prompt: string) => {
      try {
        const response = await api.put(`/lessons/${lessonId}`, { prompt })

        if (response) {
          toast.success("Lesson prompt updated")
        }
      } catch (error) {
        console.error("Error updating lesson prompt:", error)
        toast.error("Failed to update lesson prompt")
      }
    },
    [api],
  )

  // Update the generateAllLessonPlans function to use the correct URL format
  const generateAllLessonPlans = useCallback(async () => {
    console.log("Generating all lesson plans for course ID:", courseId)
    setLoadingMessage("Generating lesson plans...")
    await startTask(`/courses/${courseId}/lessons/plan`, "Generating lesson plans...")
  }, [courseId, startTask])

  // Also update the other task functions to use the same pattern
  const writeLessonContent = useCallback(
    async (lessonId: number) => {
      console.log("Writing lesson content for lesson ID:", lessonId)
      setLoadingMessage("Writing lesson content...")
      await startTask(`/lessons/${lessonId}/write`, "Writing lesson content...")
    },
    [startTask],
  )

  const generateLessonPlan = useCallback(
    async (lessonId: number) => {
      console.log("Generating lesson plan for lesson ID:", lessonId)
      setLoadingMessage("Generating lesson plan...")
      await startTask(`/lessons/${lessonId}/plan`, "Generating lesson plan...")
    },
    [startTask],
  )

  const writeAllLessonContents = useCallback(async () => {
    console.log("Writing all lesson contents for course ID:", courseId)
    setLoadingMessage("Writing all lesson contents...")
    // Content is changing, any previously generated slides may be outdated
    setDoesCourseHaveSlides(false)
    completingTaskType.current = 'other'
    await startTask(`/courses/${courseId}/lessons/write`, "Writing all lesson contents...")
  }, [courseId, startTask])

  const generateLessonSlides = useCallback(
    async (lessonId: number) => {
      console.log("Generating slides for lesson ID:", lessonId)
      setLoadingMessage("Generating slides...")
      completingTaskType.current = 'other' // Individual lesson slide generation doesn't affect course-wide status directly yet
      await startTask(`/lessons/${lessonId}/slides`, "Generating slides...")
    },
    [startTask, startPolling],
  )

  const generateAllLessonSlides = useCallback(async () => {
    console.log("Generating all lesson slides for course ID:", courseId)
    setLoadingMessage("Generating all slides...")
    // Mark slides generation as started so that the UI can reflect progress
    completingTaskType.current = 'slides' // Mark that the task starting is for slides
    const success = await startTask(`/courses/${courseId}/slides`, "Generating all slides...")

    // After generation we might directly allow user to download; no extra HEAD
    if (success) {
      console.log("Slides generated for course, ready to download")
      // The polling cycle will flip the status to "completed" once finished.
    } else {
      // If the task failed to start, reset the status so the user can retry
      setDoesCourseHaveSlides(false)
    }
  }, [courseId, startTask])

  const toggleLesson = (lessonId: number) => {
    setOpenLessons((current) =>
      current.includes(lessonId) ? current.filter((id) => id !== lessonId) : [...current, lessonId],
    )
  }

  const areAllLessonsComplete = useCallback(() => {
    return (
      lessons.length > 0 &&
      lessons.every(
        (lesson) =>
          lesson.sections && lesson.sections.length > 0 && lesson.sections.every((section) => section.content),
      )
    )
  }, [lessons])

  const startEditingTitle = useCallback((lessonId: number, currentTitle: string) => {
    setEditingTitles((prev) => [...prev, lessonId])
    setEditingTitleValues((prev) => ({ ...prev, [lessonId]: currentTitle }))
  }, [])

  const cancelEditingTitle = useCallback((lessonId: number) => {
    setEditingTitles((prev) => prev.filter((id) => id !== lessonId))
    setEditingTitleValues((prev) => {
      const newValues = { ...prev }
      delete newValues[lessonId]
      return newValues
    })
  }, [])

  const updateLessonTitle = useCallback(
    async (lessonId: number) => {
      const newTitle = editingTitleValues[lessonId]
      if (!newTitle || newTitle.trim() === "") {
        toast.error("Lesson title cannot be empty")
        return
      }
      try {
        const response = await api.put(`/lessons/${lessonId}`, { title: newTitle })

        if (response) {
          setLessons((prevLessons) =>
            prevLessons.map((lesson) => (lesson.id === lessonId ? { ...lesson, title: newTitle } : lesson)),
          )
          setEditingTitles((prev) => prev.filter((id) => id !== lessonId))
          setEditingTitleValues((prev) => {
            const newValues = { ...prev }
            delete newValues[lessonId]
            return newValues
          })
          toast.success("Lesson title updated")
        }
      } catch (error) {
        console.error("Error updating lesson title:", error)
        toast.error("Failed to update lesson title")
      }
    },
    [editingTitleValues, api],
  )

  // Update the downloadAllLessonSlides function to check if slides exist and provide better error messages
  const downloadAllLessonSlides = useCallback(
    async (format = "pptx") => {
      const filename = `course_${courseId}_slides.${format}`
      setCurrentDownloadFilename(filename)
      
      // Direct download without precheck - backend will handle availability
      await downloadFileWithProgress(
        `/courses/${courseId}/slides/${format}`,
        filename
      )
    },
    [courseId, downloadFileWithProgress]
  )

  // Similarly, download lesson slides directly without pre-checking existence
  const downloadLessonSlides = useCallback(
    async (lessonId: number, format = "pptx") => {
      const filename = `lesson_${lessonId}.${format}`
      setCurrentDownloadFilename(filename)
      
      // Direct download without precheck - backend will handle availability
      await downloadFileWithProgress(
        `/lessons/${lessonId}/slides/${format}`, 
        filename
      )
    },
    [downloadFileWithProgress],
  )

  // Añadir un efecto para forzar una actualización después de que se complete una tarea
  useEffect(() => {
    if (!isTaskLoading && !isWorking) {
      // Programar una actualización después de que se complete una tarea
      const timeoutId = setTimeout(() => {
        console.log("Scheduled update after task state change")
        fetchLessons()
      }, 1000)

      return () => clearTimeout(timeoutId)
    }
  }, [isTaskLoading, isWorking, fetchLessons])

  // Función para recargar completamente la página
  const reloadPage = useCallback(() => {
    console.log("Reloading page...")
    window.location.reload()
  }, [])

  // Effect to check slide status when a task finishes
  const prevIsWorking = useRef(isWorking); // Track previous value
  useEffect(() => {
    // Check only when isWorking transitions from true to false
    if (prevIsWorking.current === true && isWorking === false) {
      console.log("[useEffect isWorking] Detected task completion (true -> false)");
      
      // Check if the completed task was for slide generation
      if (completingTaskType.current === 'slides') {
        console.log("[useEffect isWorking] Slide generation completed. Will reload page to ensure UI updates.");
        
        // Short delay to let the backend finish any remaining operations
        setTimeout(() => {
          console.log("Reloading page to refresh UI after slide generation...");
          window.location.reload();
        }, 1000);
      } else {
        // For other task types, still check slide status
        console.log("[useEffect isWorking] Other task completed. Checking slide status normally.");
        checkAndUpdateSlideStatus();
      }
    }
    prevIsWorking.current = isWorking; // Update previous value for next render
  }, [isWorking, checkAndUpdateSlideStatus]); // Depend on isWorking and the check function

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center space-y-4">
        <p className="text-red-500">{error}</p>
        <Button onClick={fetchLessons} variant="outline" className="gap-2">
          <RefreshCcw className="h-4 w-4" />
          Retry
        </Button>
        <Button onClick={() => (window.location.href = "/courses")} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Courses
        </Button>
      </div>
    )
  }

  return (
    <EnhancedErrorBoundary>
      <div className="space-y-6">
        {/* Botón de recarga de emergencia */}
        {showReloadButton && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-red-500 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>Se ha detectado un problema. Por favor, recarga la página.</span>
            </div>
            <Button variant="outline" onClick={reloadPage} className="text-white border-white hover:bg-red-600">
              Recargar página
            </Button>
          </div>
        )}

        <div className="space-y-6 max-w-4xl mx-auto">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Loading Modal */}
          <LoadingModal
            open={isTaskLoading || isWorking}
            onOpenChange={() => {
              // Only allow closing if not in a task
              if (!isTaskLoading && !isWorking) {
                stopPolling()
              }
            }}
            message={taskError ? `Error: ${taskError.message}` : taskMessage || loadingMessage || "Processing..."}
          />

          {/* Download Progress Indicator */}
          <DownloadProgress isDownloading={isDownloading} progress={progress} filename={currentDownloadFilename} />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">{courseTitle}</h1>
              {areAllLessonsComplete() && (
                <Button onClick={() => (window.location.href = `/courses/${courseId}/complete`)} className="gap-2">
                  <Eye className="h-4 w-4" />
                  {t("lessonList.viewCompleteCourse")}
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={generateAllLessonPlans}
                disabled={isTaskLoading || isWorking || isDownloading}
                className="gap-2"
              >
                {isTaskLoading || isWorking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("lessonList.generatingAllPlans")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {t("lessonList.generateAllPlans")}
                  </>
                )}
              </Button>

              {hasGeneratedPlans() && (
                <Button
                  onClick={writeAllLessonContents}
                  disabled={isTaskLoading || isWorking || isDownloading}
                  className="gap-2"
                >
                  {isTaskLoading || isWorking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("lessonList.writingAllContents")}
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      {t("lessonList.writeAllContents")}
                    </>
                  )}
                </Button>
              )}

              {hasWrittenContents() && (
                <Button
                  onClick={generateAllLessonSlides}
                  disabled={isTaskLoading || isWorking || isDownloading}
                  className="gap-2"
                >
                  {isTaskLoading || isWorking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("lessonList.generatingAllSlides")}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      {t("lessonList.generateAllSlides")}
                    </>
                  )}
                </Button>
              )}

              {/* Only show download button if slides have been generated */}
              {doesCourseHaveSlides === true && (
                <Button
                  onClick={() => downloadAllLessonSlides("pptx")}
                  disabled={isTaskLoading || isWorking}
                  className="gap-2"
                >
                  <FileDown className="h-4 w-4" />
                  {t("lessonList.downloadAllSlides")}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            {lessons.map((lesson) => (
              <Collapsible
                key={lesson.id}
                open={openLessons.includes(lesson.id)}
                onOpenChange={() => toggleLesson(lesson.id)}
              >
                <Card className="overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            {editingTitles.includes(lesson.id) ? (
                              <div className="flex-1 flex items-center gap-2">
                                <Input
                                  value={editingTitleValues[lesson.id] || ""}
                                  onChange={(e) =>
                                    setEditingTitleValues((prev) => ({ ...prev, [lesson.id]: e.target.value }))
                                  }
                                  className="text-lg font-medium"
                                  placeholder={t("lessonList.lessonTitle")}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    updateLessonTitle(lesson.id)
                                  }}
                                >
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    cancelEditingTitle(lesson.id)
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <CardTitle
                                className="text-lg font-medium hover:text-primary"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEditingTitle(lesson.id, lesson.title)
                                }}
                              >
                                {lesson.title}
                              </CardTitle>
                            )}
                          </div>
                          {lesson.duration_minutes && (
                            <CardDescription>
                              {t("lessonList.duration")}: {Math.floor(lesson.duration_minutes / 60)}h{" "}
                              {lesson.duration_minutes % 60}m
                            </CardDescription>
                          )}
                        </div>
                        <Button variant="ghost" size="sm">
                          {openLessons.includes(lesson.id) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="space-y-6 pt-6">
                      <div className="space-y-2">
                        <CardDescription>{t("lessonList.lessonPrompt")}</CardDescription>
                        <div className="flex gap-2">
                          <Textarea
                            value={lesson.prompt}
                            onChange={(e) => {
                              const newLessons = lessons.map((l) =>
                                l.id === lesson.id ? { ...l, prompt: e.target.value } : l,
                              )
                              setLessons(newLessons)
                            }}
                            onBlur={() => updateLessonPrompt(lesson.id, lesson.prompt)}
                            rows={6}
                            className="min-h-[150px] resize-y flex-1"
                            placeholder={t("lessonList.lessonPromptPlaceholder")}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => generateLessonPlan(lesson.id)}
                          disabled={isTaskLoading || isWorking || isDownloading}
                          className="gap-2"
                        >
                          {isTaskLoading || isWorking ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("lessonList.generatingPlan")}
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4" />
                              {lesson.sections && lesson.sections.length > 0
                                ? t("lessonList.regeneratePlan")
                                : t("lessonList.generatePlan")}
                            </>
                          )}
                        </Button>

                        {lesson.sections && lesson.sections.length > 0 && (
                          <Button
                            onClick={() => writeLessonContent(lesson.id)}
                            disabled={isTaskLoading || isWorking || isDownloading}
                            className="gap-2"
                          >
                            {isTaskLoading || isWorking ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("lessonList.writingContent")}
                              </>
                            ) : (
                              <>
                                <Pencil className="h-4 w-4" />
                                {hasLessonContent(lesson) ? t("lessonList.rewriteContent") : t("lessonList.writeContent")}
                              </>
                            )}
                          </Button>
                        )}

                        {lesson.sections && lesson.sections.length > 0 && hasLessonContent(lesson) && (
                          <Button
                            onClick={() => generateLessonSlides(lesson.id)}
                            disabled={isTaskLoading || isWorking || isDownloading}
                            className="gap-2"
                          >
                            {isTaskLoading || isWorking ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("lessonList.generatingSlides")}
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4" />
                                {hasLessonContent(lesson) ? t("lessonList.regenerateSlides") : t("lessonList.generateSlides")}
                              </>
                            )}
                          </Button>
                        )}

                        {/* download button always available; backend validates existence */}
                        {hasLessonContent(lesson) && (
                          <Button
                            onClick={() => downloadLessonSlides(lesson.id, "pptx")}
                            disabled={isDownloading || isTaskLoading || isWorking}
                            className="gap-2"
                          >
                            <FileDown className="h-4 w-4" />
                            {t("lessonList.downloadSlides")}
                          </Button>
                        )}
                      </div>

                      {lesson.sections && lesson.sections.length > 0 && (
                        <div className="space-y-4">
                          <CardDescription>{t("lessonList.sections")}</CardDescription>
                          <div className="grid gap-2">
                            {lesson.sections.map((section) => (
                              <div
                                key={section.id}
                                className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
                              >
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-lg font-medium">
                                      {section.short_description || section.title || t("lessonList.untitledSection")}
                                    </h4>
                                    {section.duration_minutes && (
                                      <span className="text-sm text-muted-foreground">{section.duration_minutes}m</span>
                                    )}
                                  </div>

                                  {/* Add a preview of the section content using MarkdownContent */}
                                  {section.content && (
                                    <div className="mt-2 border-t pt-2">
                                      <MarkdownContent
                                        content={
                                          section.content.length > 150
                                            ? `${section.content.substring(0, 150)}...`
                                            : section.content
                                        }
                                      />
                                    </div>
                                  )}

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => router.push(`/lessons/${lesson.id}/sections?lang=${language}`)}
                                    className="w-full mt-2"
                                  >
                                    {t("lessonList.editSectionDetails")}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
          {isLoading && (
            <div className="fixed top-4 right-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </div>
      </div>
    </EnhancedErrorBoundary>
  )
}
