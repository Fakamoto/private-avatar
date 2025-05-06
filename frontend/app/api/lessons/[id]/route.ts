import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Await the params object
    const params = await context.params
    const id = params.id

    console.log(`Fetching lesson with ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/lessons/${id}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Error response: ${response.status} ${response.statusText}`)
      console.error(`Error body: ${errorText}`)
      return NextResponse.json(
        { error: `Failed to fetch lesson: ${response.status} ${response.statusText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error fetching lesson:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch lesson" },
      { status: 500 },
    )
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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const response = await fetch(`${API_BASE_URL}/lessons/${id}`, {
      method: "DELETE",
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to delete lesson" }, { status: response.status })
    }

    return NextResponse.json({ message: "Lesson deleted successfully" })
  } catch (error) {
    console.error("Error deleting lesson:", error)
    return NextResponse.json({ error: "Failed to delete lesson" }, { status: 500 })
  }
}

