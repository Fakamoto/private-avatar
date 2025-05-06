import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

// Simplify the route handler to use the most basic form
export async function GET(request: Request, context: { params: { id: string } }) {
  // Await the params object before accessing its properties
  const params = await context.params
  const id = params.id

  console.log(`Fetching documents for course ID: ${id}`)

  try {
    const response = await fetch(`${API_BASE_URL}/courses/${id}/documents`)

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to fetch documents" }, { status: response.status })
    }

    const documents = await response.json()
    return NextResponse.json(documents)
  } catch (error) {
    console.error("Error fetching documents:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}

// Simplify the route handler to use the most basic form
export async function POST(request: Request, context: { params: { id: string } }) {
  // Await the params object before accessing its properties
  const params = await context.params
  const id = params.id

  try {
    const formData = await request.formData()
    const response = await fetch(`${API_BASE_URL}/courses/${id}/documents`, {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to upload document" }, { status: response.status })
    }

    const document = await response.json()
    return NextResponse.json(document)
  } catch (error) {
    console.error("Error uploading document:", error)
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}

