#######################
# IMPORTS
#######################
from typing import Optional

from fastapi import Depends, HTTPException, APIRouter
# from backend.utils import sanitize_latex
from sqlmodel import Session 

from backend.database import (
    Course,
    Section,
    get_session,
)

router = APIRouter()


import pypandoc, subprocess, tempfile, os, textwrap

def latex_ok(md: str) -> tuple[bool, str]:
    """
    Validate a Markdown string exactly the way the final pipeline will.
    Returns (True, '') on success, or (False, full_latex_log) on failure.
    """

    try:
        # markdown → *stand-alone* LaTeX (includes \documentclass, etc.)
        tex = pypandoc.convert_text(
            md, to="latex", format="markdown",
            extra_args=["-s"]                     # <- stand-alone flag
        )
    except Exception as e:
        return False, f"Pandoc conversion error:\n{e}"

    with tempfile.TemporaryDirectory() as tmp:
        tex_file = os.path.join(tmp, "doc.tex")
        with open(tex_file, "w", encoding="utf-8") as f:
            f.write(tex)

        cmd = [
            "xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-shell-escape",   # same flag your minted PDF build uses
            "-no-pdf",         # parse only; no real PDF output
            "-output-directory", tmp,
            tex_file,
        ]

        proc = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
        log = proc.stdout.decode(errors="ignore")
        return proc.returncode == 0, textwrap.dedent(log)
#######################
# CRUD ENDPOINTS
#######################

@router.get("/sanitize/{course_id}", tags=["Test"])
async def sanitize_course_endpoint(course_id: int, session: Session = Depends(get_session)):
    """Sanitize a course"""
    course = session.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    for lesson in course.lessons:
        for section in lesson.sections:
            ok, log = latex_ok(section.content)
            if not ok:
                return {"status": "error", "message": "Invalid math in section content id: " + str(section.id) + "\nlog:\n" + log}
    return {"status": "all good"}


@router.get("/sanitize/section/{section_id}", tags=["Test"])
async def sanitize_section_endpoint(section_id: int, session: Session = Depends(get_session)):
    """Sanitize a section"""
    section = session.get(Section, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    ok, log = latex_ok(section.content)
    if not ok:
        return {"status": "error", "message": "Invalid math in section content id: " + str(section.id) + "\nlog:\n" + log}
    return {"status": "all good"}