export interface Course {
    id: number
    name: string
    title?: string
    lessons: Lesson[]
  }
  
  export interface Lesson {
    id: number
    title: string
    prompt: string
    sections: Section[]
  }
  
  export interface Section {
    id: number
    title: string
    content: string
    short_description: string
    length: string
    style: string
    instructions: string
    previous_section_context: string
    next_section_context: string
  }
  
  