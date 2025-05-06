import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const response = await fetch(`${API_BASE_URL}/courses/${id}/slides/pptx`)

    if (!response.ok) {
      throw new Error("Failed to download slides")
    }

    const buffer = await response.arrayBuffer()
    
    // Get the content disposition header from the backend response
    const contentDisposition = response.headers.get("content-disposition")
    const contentType = response.headers.get("content-type") || "application/vnd.openxmlformats-officedocument.presentationml.presentation"

    // Create response headers, including the original Content-Disposition if available
    const headers: Record<string, string> = {
      "Content-Type": contentType
    }
    
    if (contentDisposition) {
      headers["Content-Disposition"] = contentDisposition
    }

    return new NextResponse(buffer, { headers })
  } catch (error) {
    console.error("Error downloading slides:", error)
    return NextResponse.json({ error: "Failed to download slides" }, { status: 500 })
  }
}

