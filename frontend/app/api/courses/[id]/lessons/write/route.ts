import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  console.log(`Writing content for all lessons in course ID: ${id}`)

  try {
    const response = await fetch(`${API_BASE_URL}/courses/${id}/lessons/write`, {
      method: "POST",
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      const errorText = await response.text()
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: "Failed to write lesson contents" }, { status: response.status })
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error writing lesson contents:", error)
    return NextResponse.json({ error: "Failed to write lesson contents" }, { status: 500 })
  }
}

