import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function PUT(request: Request, context: { params: { id: string } }) {
  try {
    const id = context.params.id
    const body = await request.json()

    if (!body.preset) {
      return NextResponse.json(
        { error: "Missing required field (preset)" },
        { status: 400 }
      )
    }

    console.log(`Updating preset for course ${id} to: ${body.preset}`)
    
    const url = `${API_BASE_URL}/courses/${id}/preset?preset=${body.preset}`
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      }
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error updating course preset: ${errorBody}`)
      return NextResponse.json(
        { error: "Failed to update course preset", details: errorBody },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log("Course preset updated successfully:", data)
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating course preset:", error)
    return NextResponse.json(
      {
        error: "Failed to update course preset",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
} 