#######################
# IMPORTS
#######################
import json
from typing import List

from fastapi import Depends, HTTPException, UploadFile, APIRouter
from sqlmodel import Session

from backend.database import (
    Chunk,
    Course,
    Document,
    get_session,
)
from backend.utils import Chunks, get_file_content


#######################
# ROUTER INSTANCE
#######################
router = APIRouter()


#######################
# CRUD ENDPOINTS
#######################


@router.post("/courses/{course_id}/documents", response_model=Document, tags=["Documents"])
async def upload_document_endpoint(
    course_id: int, file: UploadFile, session: Session = Depends(get_session)
):
    """Upload a document and process it into chunks with embeddings"""
    course = session.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    content = await get_file_content(file)

    # Create document
    document = Document(
        name=file.filename, 
        original_size=len(content), 
        course=course
    )
    session.add(document)

    chunks = Chunks.get_chunks(content)

    for chunk_obj in chunks.chunks:
        chunk = Chunk(
            chunk=chunk_obj.chunk,
            embedding=json.dumps(chunk_obj.embedding),
            document=document,
        )
        session.add(chunk)

    session.commit()
    session.refresh(document)
    return document


@router.delete("/documents/{document_id}", tags=["Documents"])
async def delete_document_endpoint(
    document_id: int, session: Session = Depends(get_session)
):
    """Delete a document and its chunks"""
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    session.delete(document)
    session.commit()
    return {"ok": True}


@router.get("/courses/{course_id}/documents", response_model=List[Document], tags=["Documents"])
async def list_course_documents_endpoint(
    course_id: int, session: Session = Depends(get_session)
):
    """List all documents for a specific course"""
    course = session.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.documents


@router.get("/documents/{document_id}", response_model=Document, tags=["Documents"])
async def get_document_endpoint(
    document_id: int, session: Session = Depends(get_session)
):
    """Get a specific document by ID"""
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document