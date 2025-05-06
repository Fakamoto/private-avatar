import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BookOpen, Users, Award, Lightbulb } from "lucide-react"

interface TeamMember {
  name: string
  role: string
  image: string
}

const teamMembers: TeamMember[] = [
  { name: "Jane Doe", role: "CEO & Founder", image: "/placeholder.svg?height=200&width=200" },
  { name: "John Smith", role: "CTO", image: "/placeholder.svg?height=200&width=200" },
  { name: "Alice Johnson", role: "Head of Education", image: "/placeholder.svg?height=200&width=200" },
  { name: "Bob Williams", role: "Lead Developer", image: "/placeholder.svg?height=200&width=200" },
]

export function AboutUs() {
  return (
    <div className="container mx-auto max-w-5xl px-4">
      <h1 className="text-4xl font-bold mb-8 text-center">About Course Generator</h1>

      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-4">Our Mission</h2>
        <p className="text-lg text-muted-foreground mb-6">
          At Course generator, we are dedicated to revolutionizing online education by providing a platform that empowers educators
          and engages learners. Our mission is to make high-quality education accessible to everyone, everywhere.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <BookOpen className="mr-2 h-5 w-5 text-primary" />
                Diverse Courses
              </CardTitle>
            </CardHeader>
            <CardContent>
              Offering a wide range of subjects to cater to various learning needs and interests.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="mr-2 h-5 w-5 text-primary" />
                Community-Driven
              </CardTitle>
            </CardHeader>
            <CardContent>
              Fostering a collaborative environment where educators and learners can connect and grow together.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Award className="mr-2 h-5 w-5 text-primary" />
                Quality Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              Ensuring high standards in course content and delivery for the best learning outcomes.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Lightbulb className="mr-2 h-5 w-5 text-primary" />
                Innovative Learning
              </CardTitle>
            </CardHeader>
            <CardContent>
              Incorporating cutting-edge educational technologies to enhance the learning experience.
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-4">Our Team</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {teamMembers.map((member, index) => (
            <Card key={index}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center">
                  <Image
                    src={member.image || "/placeholder.svg"}
                    alt={member.name}
                    width={100}
                    height={100}
                    className="rounded-full mb-4"
                  />
                  <h3 className="font-semibold text-lg">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="text-center">
        <h2 className="text-2xl font-semibold mb-4">Join Us in Shaping the Future of Education</h2>
        <p className="text-lg text-muted-foreground mb-6">
          Whether you are an educator looking to share your knowledge or a learner eager to expand your horizons, EduApp
          is here to support your journey.
        </p>
        <Button size="lg">Get Started</Button>
      </section>
    </div>
  )
}

