import json
import os
from typing import List, Optional

from backend import utils
from backend.ai import SectionInformation, StructuredLessonPlan
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////data/database.db")
engine = create_engine(DATABASE_URL, echo=False)

def get_session():
    with Session(engine) as session:
        yield session


#######################
# MODELS
#######################


class Document(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    original_size: int
    course_id: Optional[int] = Field(default=None, foreign_key="course.id")
    course: Optional["Course"] = Relationship(back_populates="documents")
    chunks: List["Chunk"] = Relationship(
        back_populates="document",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Chunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chunk: str
    embedding: str = Field(description="The embedding vector stored as a JSON string")
    document_id: Optional[int] = Field(default=None, foreign_key="document.id")
    document: Optional[Document] = Relationship(back_populates="chunks")


class Course(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    language: Optional[str] = None  # ES, EN, PT, etc
    prompt: Optional[str] = None
    number_of_lessons: Optional[int] = Field(
        default=None, ge=1
    )  
    duration_minutes: Optional[int] = Field(default=None, ge=1)
    title: Optional[str] = None  # Generated title from AI
    time_structure: Optional[str] = Field(default=None, description="Stored as JSON string")
    preset: Optional[str] = None  # Default preset for course slides
    background: Optional[str] = None  # Default background for course slides
    is_working: bool = Field(default=False)
    documents: List[Document] = Relationship(
        back_populates="course",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    lessons: List["Lesson"] = Relationship(
        back_populates="course",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    ai_images: bool = Field(default=False)

    def get_relevant_content(
        self, query: str, threshold: float = 0.5, top_k: int = 10
    ) -> list[str]:
        """Get relevant content from course documents using semantic search.
        Gets top_k most relevant chunks from each document.

        Args:
            query (str): The query to search for
            threshold (float, optional): Minimum similarity score. Defaults to 0.5.
            top_k (int, optional): Maximum number of results PER DOCUMENT. Defaults to 10.

        Returns:
            list[str]: List of relevant chunks from all documents, top_k from each
        """
        if not self.documents:
            return []

        all_relevant_chunks = []

        # Process each document separately
        for document in self.documents:
            # Convert document chunks to utils.Chunks format
            chunks_list = []
            for chunk in document.chunks:
                chunks_list.append(
                    utils.Chunk(
                        chunk=chunk.chunk, embedding=json.loads(chunk.embedding)
                    )
                )

            # Get top_k chunks from this document
            chunks = utils.Chunks(chunks=chunks_list)
            document_chunks = chunks.order_by_similarity(
                query, threshold=threshold, top_k=top_k
            )
            all_relevant_chunks.extend(document_chunks)

        return all_relevant_chunks

class Lesson(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    prompt: str
    time_structure: Optional[str] = Field(default=None, description="Stored as JSON string")
    duration_minutes: Optional[int] = Field(default=None, ge=1)
    course_id: Optional[int] = Field(default=None, foreign_key="course.id")
    course: Optional["Course"] = Relationship(back_populates="lessons")
    sections: List["Section"] = Relationship(
        back_populates="lesson",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    general_plan: Optional[str] = None
    def get_structured_plan(self) -> StructuredLessonPlan:
        """Returns a StructuredLessonPlan from the lesson's sections"""
        return StructuredLessonPlan(
            general_plan=self.general_plan or "",
            sections=[
                SectionInformation(
                    short_description=section.short_description,
                    duration_minutes=section.duration_minutes,
                    instructions=section.instructions,
                    style=section.style,
                )
                for section in self.sections
            ]
        )


class Section(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: Optional[str] = None
    content: Optional[str] = None
    # Structured plan fields
    short_description: Optional[str] = None
    instructions: Optional[str] = None
    style: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1)

    lesson_id: Optional[int] = Field(default=None, foreign_key="lesson.id")
    lesson: Optional["Lesson"] = Relationship(back_populates="sections")
    slides: List["Slide"] = Relationship(
        back_populates="section",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    quiz: Optional["Quiz"] = Relationship(
        back_populates="section",
        sa_relationship_kwargs={
            "uselist": False,
            "cascade": "all, delete-orphan"
        }
    )
    # Removed quiz_id as the foreign key (section_id) is in the Quiz table for one-to-one


class Slide(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    markdown_content: str = Field(description="Pandoc-compatible markdown for this slide")
    section_id: Optional[int] = Field(default=None, foreign_key="section.id")
    section: Optional["Section"] = Relationship(back_populates="slides")

class QuizModel(SQLModel):
    """Used for llm completion"""
    title: str
    question: str
    correct_answer: str
    incorrect_answer_1: str
    incorrect_answer_2: str
    incorrect_answer_3: str


class Quiz(QuizModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_answer: Optional[str] = Field(default=None)
    section_id: Optional[int] = Field(default=None, foreign_key="section.id", unique=True)
    section: Optional["Section"] = Relationship(back_populates="quiz")

#######################
# RESPONSE MODELS
#######################

class SectionRead(SQLModel):
    id: int
    title: Optional[str] = None
    content: Optional[str] = None
    short_description: Optional[str] = None
    instructions: Optional[str] = None
    style: Optional[str] = None
    duration_minutes: Optional[int] = None
    slides: List[Slide] = []
    quiz: Optional[Quiz] = None

class LessonRead(SQLModel):
    id: int
    title: str
    prompt: str
    duration_minutes: Optional[int] = None
    sections: List[SectionRead]

class CourseRead(SQLModel):
    id: int
    name: str
    language: Optional[str] = None
    title: Optional[str] = None
    duration_minutes: Optional[int] = None
    lessons: List[LessonRead] = []