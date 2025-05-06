#######################
# IMPORTS
#######################
from typing import Optional

from fastapi import Depends, HTTPException, APIRouter
from pydantic import BaseModel
from sqlmodel import Session 

from backend.database import (
    Section,
    SectionRead,
    get_session,
)

router = APIRouter()

#######################
# MODELS
#######################

class UpdateSectionRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    short_description: Optional[str] = None
    duration_minutes: Optional[int] = None
    instructions: Optional[str] = None
    style: Optional[str] = None



#######################
# CRUD ENDPOINTS
#######################

@router.get("/sections/{section_id}", response_model=SectionRead, tags=["Sections"])
async def get_section_endpoint(section_id: int, session: Session = Depends(get_session)):
    """Get a specific section by ID"""
    section = session.get(Section, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    return section
 
@router.put("/sections/{section_id}", response_model=SectionRead, tags=["Sections"])
async def update_section_endpoint(
    section_id: int,
    request: UpdateSectionRequest,
    session: Session = Depends(get_session),
):
    """Update a section's fields including plan details"""
    section = session.get(Section, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="section not found")

    for field, value in request.model_dump().items():
        if hasattr(section, field):
            setattr(section, field, value)

    session.add(section)
    session.commit()
    session.refresh(section)
    return section
