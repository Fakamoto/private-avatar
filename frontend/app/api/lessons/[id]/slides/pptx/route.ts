import { NextResponse } from "next/server"

// Get the API base URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const lessonId = params.id
    console.log(`Fetching lesson slides PPTX for lesson ${lessonId}`)
    console.log(`API_BASE_URL: ${API_BASE_URL}`)

    // Forward the request to the backend with no-cache headers
    const url = `${API_BASE_URL}/lessons/${lessonId}/slides/pptx`
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
      console.error(`Failed to get slides PPTX: ${errorText}`)
      return new NextResponse(errorText, { status: response.status })
    }

    // Get the content type and other headers
    const contentType =
      response.headers.get("content-type") ||
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    const contentDisposition = response.headers.get("content-disposition")

    console.log(`Successfully fetched lesson slides PPTX with content type: ${contentType}`)

    // Get the binary data
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()

    // Prepare headers
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    }
    
    // Only add Content-Disposition if it was provided by the backend
    if (contentDisposition) {
      headers["Content-Disposition"] = contentDisposition
    }

    // Return the binary data with the correct headers
    return new NextResponse(arrayBuffer, { headers })
  } catch (error) {
    console.error("Error getting slides PPTX:", error)
    return new NextResponse("Failed to get slides PPTX", { status: 500 })
  }
}
