import { NextResponse } from "next/server"

// Get the API base URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const lessonId = params.id

    // Forward the request to the backend
    const response = await fetch(`${API_BASE_URL}/lessons/${lessonId}/slides`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })

    // Check if the response is successful
    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json({ error: `Failed to generate slides: ${errorText}` }, { status: response.status })
    }

    // Try to parse the response as JSON, but handle empty responses
    let data
    try {
      const text = await response.text()
      data = text ? JSON.parse(text) : {}
    } catch (error) {
      console.error("Error parsing JSON response:", error)
      // Return an empty object if parsing fails
      data = {}
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error generating slides:", error)
    return NextResponse.json({ error: "Failed to generate slides" }, { status: 500 })
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const lessonId = params.id

    // Forward the request to the backend
    const response = await fetch(`${API_BASE_URL}/lessons/${lessonId}/slides`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    // Check if the response is successful
    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json({ error: `Failed to get slides: ${errorText}` }, { status: response.status })
    }

    // Try to parse the response as JSON, but handle empty responses
    let data
    try {
      const text = await response.text()
      data = text ? JSON.parse(text) : {}
    } catch (error) {
      console.error("Error parsing JSON response:", error)
      // Return an empty object if parsing fails
      data = {}
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error getting slides:", error)
    return NextResponse.json({ error: "Failed to get slides" }, { status: 500 })
  }
}
