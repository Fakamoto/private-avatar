import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL


export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log(`Fetching lessons for course ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/courses/${id}/lessons`)

    if (response.status === 404) {
      console.error(`Course not found: ${id}`)
      return NextResponse.json({ error: "Course not found" }, { status: 404 })
    }

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      const errorText = await response.text()
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: "Failed to fetch lessons" }, { status: response.status })
    }

    const lessons = await response.json()
    console.log("Lessons data received:", lessons)
    return NextResponse.json(lessons)
  } catch (error) {
    console.error("Error fetching lessons:", error)
    return NextResponse.json({ error: "Failed to fetch lessons" }, { status: 500 })
  }
}



export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    console.log(`Writing content for all lessons in course ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/courses/${id}/lessons/write`, {
      method: "POST",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: errorText }, { status: response.status })
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error writing lesson contents:", error)
    return NextResponse.json({ error: "Failed to write lesson contents" }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const response = await fetch(`${API_BASE_URL}/lessons/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to update lesson" }, { status: response.status })
    }

    const updatedLesson = await response.json()
    return NextResponse.json(updatedLesson)
  } catch (error) {
    console.error("Error updating lesson:", error)
    return NextResponse.json({ error: "Failed to update lesson" }, { status: 500 })
  }
}