import { NextResponse } from "next/server"

// Get the API base URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const courseId = params.id

    // Forward the request to the backend
    const response = await fetch(`${API_BASE_URL}/courses/${courseId}/slides`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })

    // Check if the response is successful
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to generate slides: ${errorText}`)
      return NextResponse.json({ error: `Failed to generate slides: ${errorText}` }, { status: response.status })
    }

    // Return a 204 No Content response for successful slide generation
    // This avoids the JSON parsing issue since the backend returns an empty response
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error("Error generating slides:", error)
    return NextResponse.json({ error: "Failed to generate slides" }, { status: 500 })
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const courseId = params.id

    // Forward the request to the backend
    const response = await fetch(`${API_BASE_URL}/courses/${courseId}/slides`, {
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

    // Check if the response is a binary file
    const contentType = response.headers.get("content-type")
    if (contentType && contentType.includes("application/vnd.openxmlformats")) {
      // For binary responses, return the raw data
      const blob = await response.blob()
      return new NextResponse(blob, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": response.headers.get("content-disposition") || "attachment",
        },
      })
    }

    // Try to parse the response as JSON, but handle empty responses
    try {
      const text = await response.text()
      const data = text ? JSON.parse(text) : {}
      return NextResponse.json(data)
    } catch (error) {
      console.error("Error parsing JSON response:", error)
      // Return an empty object if parsing fails
      return NextResponse.json({})
    }
  } catch (error) {
    console.error("Error getting slides:", error)
    return NextResponse.json({ error: "Failed to get slides" }, { status: 500 })
  }
}
