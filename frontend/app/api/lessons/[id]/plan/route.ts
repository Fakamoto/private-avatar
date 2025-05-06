import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log(`Generating plan for lesson ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/lessons/${id}/plan`, {
      method: "POST",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)

      try {
        const errorJson = JSON.parse(errorText)
        return NextResponse.json(
          { error: errorJson.detail || errorJson.message || errorText },
          { status: response.status },
        )
      } catch {
        return NextResponse.json({ error: errorText || response.statusText }, { status: response.status })
      }
    }

    // After generating the plan, fetch the complete lesson data
    const lessonResponse = await fetch(`${API_BASE_URL}/lessons/${id}`)
    if (!lessonResponse.ok) {
      throw new Error("Failed to fetch updated lesson data")
    }

    const lessonData = await lessonResponse.json()
    return NextResponse.json(lessonData)
  } catch (error) {
    console.error("Error generating lesson plan:", error)
    return NextResponse.json(
      {
        error: "Failed to generate lesson plan: " + (error instanceof Error ? error.message : String(error)),
      },
      { status: 500 },
    )
  }
}

