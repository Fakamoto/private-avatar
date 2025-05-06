import Link from "next/link"
import Image from "next/image"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CalendarDays, User, ArrowRight } from "lucide-react"

interface BlogPost {
  id: number
  title: string
  excerpt: string
  author: string
  date: string
  image: string
}

const blogPosts: BlogPost[] = [
  {
    id: 1,
    title: "Getting Started with Online Course Creation",
    excerpt: "Learn the basics of creating engaging online courses and reach a global audience.",
    author: "Jane Doe",
    date: "2025-02-15",
    image: "/placeholder.svg?height=200&width=400",
  },
  {
    id: 2,
    title: "The Future of E-learning: Trends to Watch",
    excerpt: "Explore the emerging trends shaping the future of online education and e-learning platforms.",
    author: "John Smith",
    date: "2025-02-10",
    image: "/placeholder.svg?height=200&width=400",
  },
  {
    id: 3,
    title: "Maximizing Student Engagement in Virtual Classrooms",
    excerpt: "Discover effective strategies to keep students engaged and motivated in online learning environments.",
    author: "Alice Johnson",
    date: "2025-02-05",
    image: "/placeholder.svg?height=200&width=400",
  },
]

export function Blog() {
  return (
    <div className="container mx-auto max-w-5xl px-4">
      <h1 className="text-4xl font-bold mb-8">Course Generator Blog</h1>
      <p className="text-xl text-muted-foreground mb-12">
        Stay updated with the latest trends, tips, and insights in online education and course creation.
      </p>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {blogPosts.map((post) => (
          <Card key={post.id} className="flex flex-col">
            <Image
              src={post.image || "/placeholder.svg"}
              alt={post.title}
              width={400}
              height={200}
              className="object-cover h-48 w-full"
            />
            <CardHeader>
              <CardTitle className="line-clamp-2">{post.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4 line-clamp-3">{post.excerpt}</p>
              <div className="flex items-center text-sm text-muted-foreground">
                <User className="mr-2 h-4 w-4" />
                <span className="mr-4">{post.author}</span>
                <CalendarDays className="mr-2 h-4 w-4" />
                <span>{new Date(post.date).toLocaleDateString()}</span>
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <Button asChild variant="ghost" className="ml-auto">
                <Link href={`/blog/${post.id}`}>
                  Read More <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}

