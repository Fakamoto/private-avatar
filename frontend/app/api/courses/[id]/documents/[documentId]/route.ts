import { NextResponse } from "next/server"

export async function DELETE(request: Request, context: { params: { id: string; documentId: string } }) {
  // Get the course ID and document ID from the URL parameters
  const { id, documentId } = context.params

  console.log(`API Route: Attempting to delete document with ID: ${documentId} from course: ${id}`)

  try {
    // Get the backend URL from environment variables
    const backendUrl = process.env.API_BASE_URL || "http://backend:8000"
    console.log(`API Route: Using backend URL: ${backendUrl}`)

    // Use the document ID directly with the backend endpoint
    const apiUrl = `${backendUrl}/documents/${documentId}`
    console.log(`API Route: Sending DELETE request to: ${apiUrl}`)

    const response = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    })

    console.log(`API Route: Response status: ${response.status}`)

    // Log the response body for debugging
    let responseBody
    try {
      responseBody = await response.text()
      console.log(`API Route: Response body: ${responseBody}`)
    } catch (e) {
      console.log(`API Route: Could not read response body: ${e}`)
    }

    if (!response.ok) {
      console.error(`API Route: Backend error: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        {
          error: "Failed to delete document",
          details: responseBody,
          status: response.status,
        },
        { status: response.status },
      )
    }

    console.log(`API Route: Document deleted successfully`)
    return NextResponse.json({ message: "Document deleted successfully" })
  } catch (error) {
    console.error("API Route: Error deleting document:", error)
    return NextResponse.json(
      {
        error: "Failed to delete document",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

