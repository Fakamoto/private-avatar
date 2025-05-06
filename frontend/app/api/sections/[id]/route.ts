import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    console.log(`Updating section ${id} with data:`, body)

    const response = await fetch(`${API_BASE_URL}/sections/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: errorText }, { status: response.status })
    }

    const updatedSection = await response.json()
    return NextResponse.json(updatedSection)
  } catch (error) {
    console.error("Error updating section:", error)
    return NextResponse.json({ error: "Failed to update section" }, { status: 500 })
  }
}


export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const response = await fetch(`${API_BASE_URL}/lessons/${id}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: errorText }, { status: response.status })
    }

    const lesson = await response.json()
    return NextResponse.json(lesson)
  } catch (error) {
    console.error("Error fetching lesson:", error)
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    console.log(`Creating section for lesson ID: ${id}`)

    const response = await fetch(`${API_BASE_URL}/lessons/${id}/sections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      const errorText = await response.text()
      console.error("Backend response:", errorText)
      return NextResponse.json({ error: "Failed to create section" }, { status: response.status })
    }

    const newSection = await response.json()
    return NextResponse.json(newSection)
  } catch (error) {
    console.error("Error creating section:", error)
    return NextResponse.json({ error: "Failed to create section" }, { status: 500 })
  }
}

