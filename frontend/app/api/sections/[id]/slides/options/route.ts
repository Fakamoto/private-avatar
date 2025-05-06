import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

// ID mapping for testing
const ID_MAPPING: Record<string, string> = {
  "14": "126",
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  try {
    const id = context.params.id
    const body = await request.json()

    console.log("Received slide options update:", body)

    if (!body.background || !body.preset) {
      return NextResponse.json(
        { error: "Missing required fields (background or preset)" },
        { status: 400 }
      )
    }

    // Map the ID if needed
    const actualId = ID_MAPPING[id] || id
    console.log(`Updating slide options for section ${id} (mapped to ${actualId})`)

    // First get the current slide data
    const getResponse = await fetch(`${API_BASE_URL}/sections/${actualId}/slides`)
    
    if (!getResponse.ok) {
      const errorBody = await getResponse.text()
      console.error(`Error fetching slide: ${errorBody}`)
      return NextResponse.json(
        { error: `Failed to fetch slide: ${getResponse.status} ${getResponse.statusText}` },
        { status: getResponse.status }
      )
    }

    const currentSlide = await getResponse.json()
    
    // Update only the background and preset fields
    const updatedData = {
      ...currentSlide,
      background: body.background,
      preset: body.preset,
      bullet_points: typeof currentSlide.bullet_points === 'string' 
        ? currentSlide.bullet_points 
        : JSON.stringify(currentSlide.bullet_points)
    }

    const response = await fetch(`${API_BASE_URL}/sections/${actualId}/slides`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedData),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error updating slide options: ${errorBody}`)
      return NextResponse.json(
        { error: "Failed to update slide options", details: errorBody },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log("Slide options updated successfully:", data)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("Error updating slide options:", error)
    return NextResponse.json(
      {
        error: "Failed to update slide options",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
} 