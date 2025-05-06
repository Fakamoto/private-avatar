import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

// ID mapping for testing
const ID_MAPPING: Record<string, string> = {
  "14": "126",
}

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    // Use destructuring with a default value to handle both Promise<{id}> and {id} cases
    const id = context.params.id
    console.log(`Original section ID: ${id}`)

    // Map the ID if needed
    const actualId = ID_MAPPING[id] || id
    console.log(`Mapped section ID: ${actualId}`)

    const response = await fetch(`${API_BASE_URL}/sections/${actualId}/slides`, {
      method: "POST",
    })
    console.log("Response from backend API:", response.status, response.statusText)

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error response body: ${errorBody}`)
      return NextResponse.json(
        { error: `Failed to create slide: ${response.status} ${response.statusText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error creating slide:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create slide" },
      { status: 500 },
    )
  }
}

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const id = context.params.id

    // Map the ID if needed
    const actualId = ID_MAPPING[id] || id
    console.log(`Getting slide for section ${id} (mapped to ${actualId})`)

    const response = await fetch(`${API_BASE_URL}/sections/${actualId}/slides`)

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error response body: ${errorBody}`)
      return NextResponse.json(
        { error: `Failed to fetch slide: ${response.status} ${response.statusText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error fetching slide:", error)
    return NextResponse.json({ error: "Failed to fetch slide" }, { status: 500 })
  }
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  try {
    const id = context.params.id
    const body = await request.json()

    console.log("Received data in API route:", body)

    // Map the ID if needed
    const actualId = ID_MAPPING[id] || id
    console.log(`Updating slide for section ${id} (mapped to ${actualId})`)

    // Ensure bullet_points is a valid JSON string
    const formattedBody = {
      ...body,
      bullet_points: typeof body.bullet_points === "string" ? body.bullet_points : JSON.stringify(body.bullet_points),
    }

    const response = await fetch(`${API_BASE_URL}/sections/${actualId}/slides`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formattedBody),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`Error response body: ${errorBody}`)
      return NextResponse.json({ error: "Failed to update slide", details: errorBody }, { status: response.status })
    }

    const data = await response.json()
    console.log("Response from backend API:", data)
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating slide:", error)
    return NextResponse.json(
      {
        error: "Failed to update slide",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

