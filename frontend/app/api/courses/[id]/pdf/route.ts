import { NextResponse } from "next/server"

// Get the API base URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const courseId = params.id
    console.log(`Fetching course PDF for course ${courseId}`)
    console.log(`API_BASE_URL: ${API_BASE_URL}`)

    // Forward the request to the backend with no-cache headers
    const url = `${API_BASE_URL}/courses/${courseId}/pdf`
    console.log(`Making request to: ${url}`)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })

    // Check if the response is successful
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to get course PDF: ${errorText}`)
      return new NextResponse(errorText, { status: response.status })
    }

    // Get the content type and other headers
    const contentType = response.headers.get("content-type") || "application/pdf"
    const contentDisposition = response.headers.get("content-disposition") || `attachment; filename="course_${courseId}.pdf"`

    console.log(`Successfully fetched course PDF with content type: ${contentType}`)

    // Get the binary data
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()

    // Return the binary data with the correct headers
    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })
  } catch (error) {
    console.error("Error getting course PDF:", error)
    return new NextResponse("Failed to get course PDF", { status: 500 })
  }
} 