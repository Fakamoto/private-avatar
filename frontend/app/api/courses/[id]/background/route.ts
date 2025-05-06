import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function PUT(request: Request, context: { params: { id: string } }) {
  try {
    const id = context.params.id
    const body = await request.json()

    if (!body.background) {
      return NextResponse.json(
        { error: "Missing required field (background)" },
        { status: 400 }
      )
    }

    console.log(`Updating background for course ${id} to: ${body.background}`)
    
    const url = `${API_BASE_URL}/courses/${id}/background?background=${body.background}`
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      }
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error updating course background: ${errorBody}`)
      return NextResponse.json(
        { error: "Failed to update course background", details: errorBody },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log("Course background updated successfully:", data)
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating course background:", error)
    return NextResponse.json(
      {
        error: "Failed to update course background",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
} 