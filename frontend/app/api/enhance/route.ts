import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function POST(request: Request) {
  try {
    const body = await request.json()

    console.log("Request body to enhance:", body)

    const response = await fetch(`${API_BASE_URL}/enhance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: body.prompt,
        language: body.language,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error("Backend error:", errorData)
      return NextResponse.json(errorData, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error enhancing prompt:", error)
    return NextResponse.json({ error: "Failed to enhance prompt" }, { status: 500 })
  }
}

