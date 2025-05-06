import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()

  // Here you would typically save the contact form data to your database
  // and/or send an email notification

  console.log("Received contact form submission:", body)

  // For now, we'll just return a success response
  return NextResponse.json({ message: "Message received successfully" })
}

