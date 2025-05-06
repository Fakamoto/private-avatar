import { NextResponse } from "next/server"

// This is a mock database. In a real application, you would fetch this data from your actual database.
const blogPosts = [
  {
    id: 1,
    title: "Getting Started with Online Course Creation",
    content: "Full article content here...",
    author: "Jane Doe",
    date: "2025-02-15",
  },
  // ... more blog posts
]

export async function GET() {
  // In a real application, you might want to add pagination here
  return NextResponse.json(blogPosts)
}

