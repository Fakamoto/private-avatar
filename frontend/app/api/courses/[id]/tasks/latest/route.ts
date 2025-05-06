import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

export async function GET(request: Request, { params }: { params: { id: string } }) {
  // Fix the params warning by properly awaiting the params
  const courseId = params.id

  try {
    // Add cache control headers to prevent caching
    const response = await fetch(`${API_BASE_URL}/courses/${courseId}/tasks/latest`, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
      next: { revalidate: 0 }, // Tell Next.js not to cache this response
    })

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch task: ${response.statusText}` }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error fetching latest task:", error)
    return NextResponse.json({ error: "Failed to fetch latest task" }, { status: 500 })
  }
}

