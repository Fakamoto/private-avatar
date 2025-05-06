import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = await request.json()

    console.log("Request body to plan:", body)

    const response = await fetch(`${API_BASE_URL}/courses/${id}/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: body.prompt,
        language: body.language,
        duration_minutes: body.duration_minutes || 60, // Default to 60 minutes if not provided
      }),
    })

    if (!response.ok) {
      console.error("Backend response status:", response.status)
      console.error("Backend response status text:", response.statusText)
      const responseText = await response.text()
      console.error("Backend response body:", responseText)

      let errorMessage: string
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.error || "Unknown error occurred"
      } catch {
        errorMessage = responseText || response.statusText || "Unknown error occurred"
      }
      console.error("Parsed error message:", errorMessage)
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error generating course plan:", error)
    return NextResponse.json({ error: "Failed to generate course plan" }, { status: 500 })
  }
}

