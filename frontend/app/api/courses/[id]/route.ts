import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log(`Fetching course with ID: ${id}`) // Log para depuración

    const response = await fetch(`${API_BASE_URL}/courses/${id}`)

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to fetch course" }, { status: response.status })
    }

    const course = await response.json()
    return NextResponse.json(course)
  } catch (error) {
    console.error("Error fetching course:", error)
    return NextResponse.json({ error: "Failed to fetch course" }, { status: 500 })
  }
}

// Asegúrate de que las otras funciones (PUT, DELETE) también estén definidas aquí si las necesitas
// y que también manejen los parámetros como Promises

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const response = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to update course" }, { status: response.status })
    }

    const updatedCourse = await response.json()
    return NextResponse.json(updatedCourse)
  } catch (error) {
    console.error("Error updating course:", error)
    return NextResponse.json({ error: "Failed to update course" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const response = await fetch(`${API_BASE_URL}/courses/${id}`, {
      method: "DELETE",
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to delete course" }, { status: response.status })
    }

    return NextResponse.json({ message: "Course deleted successfully" })
  } catch (error) {
    console.error("Error deleting course:", error)
    return NextResponse.json({ error: "Failed to delete course" }, { status: 500 })
  }
}

