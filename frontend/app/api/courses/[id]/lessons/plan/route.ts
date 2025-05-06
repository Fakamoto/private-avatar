import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const response = await fetch(`${API_BASE_URL}/courses/${id}/lessons/plan`, {
      method: "POST",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: errorText || response.statusText }, { status: response.status })
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error generating lesson plans:", error)
    return NextResponse.json(
      { error: "Failed to generate lesson plans: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    )
  }
}

