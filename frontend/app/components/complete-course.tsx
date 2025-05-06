"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowLeft, FileText } from "lucide-react"
import axios from "axios"
import { useLanguage } from "@/app/context/language-context"
import { useRouter } from "next/navigation"
import { MarkdownContent } from "@/app/components/markdown-content"
import { Dialog, DialogContent } from "@/components/ui/dialog";
import QuizComponent, { Quiz, QuizAttemptState } from "@/app/components/quiz-component"
import { shuffleArray } from "@/lib/utils"
import { useApiWithRetry } from "@/hooks/use-api-with-retry";

// Interfaces
interface Section {
    id: number
    title: string
    content: string
    short_description: string
    duration_minutes: number
    quiz?: Quiz | null
}

interface Lesson {
    id: number
    title: string
    sections: Section[]
}

interface Course {
    id: number
    title: string
    lessons: Lesson[]
}

interface CompleteCourseEnhancedProps {
    courseId: string
}

/* Componente para el botón de descarga con estado de loading */
function DownloadPdfButton({ course, t }: { course: Course, t: (key: string, options?: Record<string, unknown>) => string }) {
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
  
    const handleDownload = async () => {
        setLoading(true);
        setShowModal(true);
        console.log("Solicitando PDF al servidor...");
        try {
            // Use the new API endpoint instead of client-side generation
            const response = await fetch(`/api/courses/${course.id}/pdf`);
            
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            
            // Get the blob from the response
            const blob = await response.blob();
            
            // Create a URL for the blob
            const url = URL.createObjectURL(blob);
            
            // Create a link and trigger the download
            const link = document.createElement('a');
            link.href = url;
            link.download = `${course.title}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Clean up the URL object
            URL.revokeObjectURL(url);
            
            console.log("PDF descargado del servidor.");
        } catch (error) {
            console.error("Error descargando PDF:", error);
        }
        setLoading(false);
        setShowModal(false);
    };
      
  
    return (
        <>
            <Button onClick={handleDownload} className="gap-2" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {loading ? t("completeCourse.downloadingPdf") : t("completeCourse.downloadAsPdf")}
            </Button>
      
            <Dialog open={showModal}>
                <DialogContent className="flex flex-col items-center justify-center gap-4 py-10">
                    <Loader2 className="h-10 w-10 animate-spin" />
                    <p className="text-lg font-medium">{t("completeCourse.generatingPdf")}</p>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function CompleteCourse({ courseId }: CompleteCourseEnhancedProps) {
    const { t } = useLanguage()
    const router = useRouter()
    const [course, setCourse] = useState<Course | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const { post } = useApiWithRetry();

    /** Stores UI state for every quiz keyed by the quiz id */
    const [quizStates, setQuizStates] = useState<Record<number, QuizAttemptState>>({})

    const fetchCourse = useCallback(async () => {
        try {
            setIsLoading(true)
            // Fetch course details
            const courseResponse = await axios.get(`/api/courses/${courseId}`)
            const courseData = courseResponse.data

            // Fetch lessons for the course
            const lessonsResponse = await axios.get(`/api/courses/${courseId}/lessons`)
            const lessonsData = lessonsResponse.data

            // Combine the data
            setCourse({
                ...courseData,
                lessons: lessonsData,
            })

            // ------ Build initial quiz states (shuffle once) ------ //
            const initialStates: Record<number, QuizAttemptState> = {}
            for (const lesson of lessonsData) {
                for (const section of lesson.sections) {
                    if (section.quiz && section.quiz.id != null) {
                        const quizObj: Quiz = section.quiz
                        const isAlreadyAnswered = quizObj.user_answer != null;
                        initialStates[quizObj.id!] = {
                            answered: isAlreadyAnswered,
                            selectedAnswer: isAlreadyAnswered && quizObj.user_answer ? quizObj.user_answer : null,
                            isCorrect: isAlreadyAnswered && quizObj.user_answer ? quizObj.user_answer === quizObj.correct_answer : null,
                            shuffledAnswers: shuffleArray([
                                quizObj.correct_answer,
                                quizObj.incorrect_answer_1,
                                quizObj.incorrect_answer_2,
                                quizObj.incorrect_answer_3,
                            ]),
                            originalCorrectAnswer: quizObj.correct_answer,
                        }
                    }
                }
            }
            setQuizStates(initialStates)
            setError(null)
        } catch (err) {
            console.error("Error fetching course:", err)
            setError(t("completeCourse.loadError"))
        } finally {
            setIsLoading(false)
        }
    }, [courseId, t])

    useEffect(() => {
        fetchCourse()
    }, [fetchCourse])

    if (isLoading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }

    if (error || !course) {
        return (
            <div className="flex h-[50vh] flex-col items-center justify-center space-y-4">
                <p className="text-red-500">{error || t("completeCourse.courseNotFound")}</p>
                <Button onClick={() => router.push(`/courses/${courseId}`)} variant="outline" className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    {t("completeCourse.back")}
                </Button>
            </div>
        )
    }

    return (
        <div className="container py-8">
            <div className="container py-8">
                <div className="mb-6 flex items-center justify-between">
                    <h1 className="text-2xl font-bold">{course.title}</h1>
                    <div className="flex gap-2">

                        {/* Botón de descarga PDF */}
                        <DownloadPdfButton course={course} t={t as (key: string, options?: Record<string, unknown>) => string} />

                        {/* Botón de volver */}
                        <Button
                            onClick={() => router.push(`/courses/${courseId}/lessons`)}
                            variant="outline"
                            className="gap-2"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {t("completeCourse.back")}
                        </Button>

                    </div>
                </div>
            </div>

            <div className="space-y-8">
                {course.lessons.map((lesson) => (
                    <div key={lesson.id} className="space-y-4">
                        <h2 className="text-xl font-bold border-b pb-2">{lesson.title}</h2>
                        {lesson.sections.map((section) => (
                            <div key={section.id} className="space-y-4">
                                {/* Section content */}
                                <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-semibold">{section.title}</h3>
                                        {section.short_description && <p className="text-muted-foreground">{section.short_description}</p>}
                                        {section.duration_minutes > 0 && (
                                            <p className="text-sm text-muted-foreground">
                                                {t("completeCourse.sectionDuration", {
                                                    hours: Math.floor(section.duration_minutes / 60),
                                                    minutes: section.duration_minutes % 60,
                                                })}
                                            </p>
                                        )}
                                        <div className="mt-4">
                                            <MarkdownContent content={section.content.replace(/\)\)$/, "")} />
                                        </div>
                                    </div>
                                </div>

                                {/* Quiz (if available) */}
                                {section.quiz && section.quiz.id != null && quizStates[section.quiz.id] && (
                                    <QuizComponent
                                        quiz={section.quiz}
                                        state={quizStates[section.quiz.id]}
                                        onAnswer={async (selected, isCorrect) => {
                                            // Submit answer to backend
                                            try {
                                                await post(`/api/quizzes/${section.quiz!.id}/answer`, { answer: selected });
                                                // Optionally: handle successful submission, e.g., if backend returns updated quiz
                                            } catch (apiError) {
                                                console.error("Failed to submit quiz answer:", apiError);
                                                // Optionally: show a toast to the user
                                            }

                                            // Update local state
                                            setQuizStates((prev) => ({
                                                ...prev,
                                                [section.quiz!.id!]: {
                                                    ...prev[section.quiz!.id!],
                                                    answered: true,
                                                    selectedAnswer: selected,
                                                    isCorrect,
                                                },
                                            }))
                                        }}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}