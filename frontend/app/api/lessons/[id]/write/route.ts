import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log(`Writing content for lesson ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/lessons/${id}/write`, {
      method: "POST",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: errorText || response.statusText }, { status: response.status })
    }

    const result = await response.json()
    console.log("Content written successfully:", result)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error writing lesson content:", error)
    return NextResponse.json(
      {
        error: "Failed to write lesson content: " + (error instanceof Error ? error.message : String(error)),
      },
      { status: 500 },
    )
  }
}

