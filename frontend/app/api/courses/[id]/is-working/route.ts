import { NextResponse } from "next/server"

// Get the API base URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const courseId = params.id
    console.log(`Checking if course ${courseId} is working`)

    // Forward the request to the backend
    const response = await fetch(`${API_BASE_URL}/courses/${courseId}/is-working`, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })

    // Get the response data
    const data = await response.json()
    console.log(`Course ${courseId} is working: ${data.is_working}`)

    // Return the response
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error checking if course is working:", error)
    return NextResponse.json({ is_working: false }, { status: 500 })
  }
}
