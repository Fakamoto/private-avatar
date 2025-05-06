import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import PptxGenJS from "pptxgenjs"

export async function GET(request: NextRequest) {
  try {
    // Extract the id from the URL path instead of using params
    const url = new URL(request.url)
    const pathParts = url.pathname.split("/")
    const courseId = pathParts[pathParts.indexOf("courses") + 1]

    const apiBaseUrl = process.env.API_BASE_URL

    if (!apiBaseUrl) {
      throw new Error("API_BASE_URL is not defined in environment variables")
    }

    console.log("Fetching lessons...")
    const lessonsResponse = await axios.get(`${apiBaseUrl}/courses/${courseId}/lessons`)
    const lessons = lessonsResponse.data
    console.log("Lessons fetched:", lessons)

    // Create a new PPTX
    const pres = new PptxGenJS()

    // For each lesson, get its slides and add them to the PPTX
    for (const lesson of lessons) {
      console.log(`Fetching slides for lesson ${lesson.id}...`)
      const slidesResponse = await axios.get(`${apiBaseUrl}/lessons/${lesson.id}/slides`)
      const slides = slidesResponse.data
      console.log(`Slides fetched for lesson ${lesson.id}:`, slides)

      for (const slide of slides) {
        const newSlide = pres.addSlide()
        newSlide.addText(slide.title, { x: 0.5, y: 0.5, w: "90%", h: 1, fontSize: 24 })

        const bulletPoints = JSON.parse(slide.bullet_points)
        newSlide.addText(bulletPoints.join("\n"), { x: 0.5, y: 1.5, w: "90%", h: 3, bullet: true })

        if (slide.additional_text) {
          newSlide.addText(slide.additional_text, { x: 0.5, y: 4.5, w: "90%", h: 1 })
        }
      }
    }

    console.log("Generating PPTX...")
    const pptxBuffer = await pres.write({ outputType: "nodebuffer" })
    console.log("PPTX generated")

    return new NextResponse(pptxBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="course_${courseId}_all_slides.pptx"`,
      },
    })
  } catch (error: unknown) {
    console.error("Error fetching all slides:", error)
    let errorMessage = "Failed to fetch all slides"
    if (axios.isAxiosError(error)) {
      errorMessage = `Error ${error.response?.status}: ${error.response?.data?.detail || error.message}`
    } else if (error instanceof Error) {
      errorMessage = error.message
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

