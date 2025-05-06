import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  // Extraer `id` de `params` de manera segura
  const { id } = params;

  console.log(`Received DELETE request for course ID: ${id}`);

  try {
    const url = `${API_BASE_URL}/courses/${id}`;
    console.log(`Sending DELETE request to: ${url}`);

    const response = await fetch(url, {
      method: "DELETE",
    });

    console.log(`Backend response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Backend error: ${response.status} ${response.statusText}`);
      console.error(`Error response body: ${errorText}`);
      return NextResponse.json({ error: "Failed to delete course", details: errorText }, { status: response.status });
    }

    console.log("Course deleted successfully");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting course:", error);
    return NextResponse.json(
      { error: "Failed to delete course", details: "An unknown error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const response = await fetch(`${API_BASE_URL}/courses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: body.name,
        description: body.description,
        duration_minutes: body.duration_minutes || 60, // Default to 60 minutes if not provided
      }),
    })

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to create course" }, { status: response.status })
    }

    const course = await response.json()
    return NextResponse.json(course)
  } catch (error) {
    console.error("Error creating course:", error)
    return NextResponse.json({ error: "Failed to create course" }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/courses/${params.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const updatedCourse = await response.json();
    return NextResponse.json(updatedCourse);
  } catch (error) {
    console.error("Error updating course:", error);
    return NextResponse.json({ error: "Failed to update course" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/courses`)

    if (!response.ok) {
      console.error(`Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json({ error: "Failed to fetch courses" }, { status: response.status })
    }

    const courses = await response.json()
    return NextResponse.json(courses)
  } catch (error) {
    console.error("Error fetching courses:", error)
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 })
  }
}


