#######################
# IMPORTS
#######################
import json
import logging
import asyncio
import urllib.parse
from pathlib import Path
from typing import List
import base64
from io import BytesIO
import re

from fastapi import BackgroundTasks, Depends, HTTPException, APIRouter, Response
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, update, delete
from sqlalchemy.orm import selectinload
from PIL import Image

from backend.database import (
    Course,
    Lesson,
    Section,
    Slide,
    engine,
    get_session,
)

from backend.utils import (
    markdown_to_pptx_bytes,
    extract_image_alts_and_paths,
    pptx_response,
)

from backend.ai import (
    write_presentation_markdown,
    create_image,
    improve_slides,
)

#######################
# LOGGING SETUP
#######################
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger("app")

# Use an *absolute* path that matches the Docker volume mount (see docker-compose.yml)
# The host `./data` directory is mounted inside the container at `/data`,
# so we save all AI-generated images under `/data/images`.
# This guarantees that Pandoc can always find the images when we later
# build the PPTX (the path will be added explicitly to `--resource-path`).
IMAGES_DIR = Path("/data/images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

#######################
# ROUTER INSTANCE
#######################
router = APIRouter()


#######################
# MODELS
#######################


#######################
# UTILS
#######################

#######################
# AI IMAGE HELPER
#######################
async def generate_ai_images_for_markdown(markdown: str, generate: bool = True) -> str:
    """Generate AI images referenced in *markdown* and rewrite links.

    Workflow
    ---------
    1. Detect all image links that **are not external URLs** using
       :func:`backend.utils.extract_image_alts_and_paths`.
    2. For each link we ask the AI to generate the image via
       :func:`backend.ai.create_image` and save it under
       ``/data/images/<filename>`` (``IMAGES_DIR``).
    3. Replace the original link in the markdown with an **absolute** path in
       the container – e.g. ``![](/data/images/foo.png)`` – so that Pandoc can
       always resolve the file (``/data`` is part of the *resource-path*).
    4. If an image fails to generate or to be written to disk, the reference is
       removed from the markdown (replaced with the alt text) to prevent Pandoc
       from erroring out later.

    Parameters
    ----------
    markdown : str
        Raw markdown that may contain image placeholders.

    Returns
    -------
    str
        The markdown with image links rewritten (or removed on failure).
    """

    image_info_list = extract_image_alts_and_paths(markdown)

    if not image_info_list:
        return markdown

    image_details: list[tuple[str, str, Path]] = []  # (alt, old_path, new_abs_path)

    if generate:
        image_tasks = []
        for alt, old_path_str in image_info_list:
            old_path = Path(old_path_str)
            new_path = IMAGES_DIR / old_path.name
            image_tasks.append(create_image(prompt=alt))
            image_details.append((alt, old_path_str, new_path))

        logger.info(f"Generating {len(image_tasks)} images referenced in markdown …")

        generated_images_bytes = await asyncio.gather(*image_tasks)
    else:
        # No generation – we will strip links later
        generated_images_bytes = [None] * len(image_info_list)
        for (alt, old_path_str) in image_info_list:
            new_path = IMAGES_DIR / Path(old_path_str).name  # preserver path for replacement
            image_details.append((alt, old_path_str, new_path))

    for (alt, old_path_str, new_path), img_obj in zip(image_details, generated_images_bytes):
        # Check for empty path string from extraction
        if not old_path_str:
            logger.warning(f"Skipping image processing for alt='{alt}' due to empty original path.")
            continue

        try:
            # If we are not generating images (generate=False) OR generation failed, strip reference.
            if not generate or img_obj is None or isinstance(img_obj, Exception):
                logger.error(
                    f"Image generation failed for alt='{alt}': {img_obj if isinstance(img_obj, Exception) else 'returned None or skipped'}"
                )
                original_markdown_link = f"![{alt}]({old_path_str})"
                markdown = markdown.replace(original_markdown_link, alt)
                continue

            if isinstance(img_obj, Image.Image):
                img_obj.save(new_path)
                logger.info(f"Successfully saved Pillow image for alt='{alt}' to {new_path}")
            else:
                # If img_obj is raw bytes-like object, attempt to write directly
                try:
                    with open(new_path, "wb") as f:
                        f.write(img_obj)
                    logger.info(f"Successfully saved bytes image for alt='{alt}' to {new_path}")
                except Exception as write_e:
                    logger.error(f"Failed writing image bytes for alt='{alt}': {write_e}")
                    # Remove unrecoverable image reference from markdown to avoid Pandoc errors later
                    original_markdown_link = f"![{alt}]({old_path_str})"
                    markdown = markdown.replace(original_markdown_link, alt)
                    continue

            # Use absolute path ("/data/images/<filename>") so Pandoc sees a valid
            # file path without relying on the slide's working directory.  The
            # `/data` directory is mounted as a resource path too, but absolute
            # paths are the safest and avoid confusion if resource-path flags
            # change in the future.
            new_rel_path = f"/data/images/{new_path.name}"
            original_markdown_link = f"![{alt}]({old_path_str})"
            replaced = False
            # Primary replacement: full link match → drop alt (safer for Pandoc)
            if original_markdown_link in markdown:
                markdown = markdown.replace(original_markdown_link, f"![]({new_rel_path})")
                replaced = True

            # Secondary replacement: just ensure every "(old_path)" is swapped
            if f"({old_path_str})" in markdown:
                markdown = markdown.replace(f"({old_path_str})", f"({new_rel_path})")
                replaced = True

            if not replaced:
                logger.warning(
                    f"[generate_ai_images_for_markdown] Could not replace path '{old_path_str}'. Alt='{alt}'. New='{new_rel_path}'."
                )
        except Exception as e:
            logger.error(f"Failed processing generated image for alt='{alt}': {e}")
            # Remove unrecoverable image reference from markdown to avoid Pandoc errors later
            original_markdown_link = f"![{alt}]({old_path_str})"
            markdown = markdown.replace(original_markdown_link, alt)

    logger.debug(f"Final markdown after image path replacement:\n{markdown}")
    return markdown

#######################
# AI ENDPOINTS
#######################

@router.post("/sections/{section_id}/slides", status_code=204, tags=["Slides"])
async def generate_section_slides_endpoint(
    section_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """Generate slide markdown content for a specific section in the background."""

    logger.info(f"Received request to generate slide markdown for section ID: {section_id}")

    section = session.get(Section, section_id)
    if not section:
        logger.error(f"Section {section_id} not found.")
        raise HTTPException(status_code=404, detail="Section not found")

    background_tasks.add_task(
        run_generate_section_markdown_task,
        section_id=section_id
    )

    logger.info(f"Added background task for generating slide markdown for section {section_id}")
    return Response(status_code=204)


@router.post("/lessons/{lesson_id}/slides", status_code=204, tags=["Slides"])
async def generate_lesson_slides_endpoint(
    lesson_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """Generate slide markdown content for all sections in a lesson in the background."""
    logger.info(f"Received request to generate slide markdown for lesson ID: {lesson_id}")

    lesson = session.get(Lesson, lesson_id)
    if not lesson:
        logger.error(f"Lesson {lesson_id} not found.")
        raise HTTPException(status_code=404, detail="Lesson not found")

    background_tasks.add_task(
        run_generate_lesson_markdown_task,
        lesson_id=lesson_id
    )

    logger.info(f"Added background task for generating slide markdown for lesson {lesson_id}")
    return Response(status_code=204)


@router.post("/courses/{course_id}/slides", status_code=204, tags=["Slides"])
async def generate_course_slides_endpoint(
    course_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """Generate slide markdown content for all sections in a course in the background."""
    logger.info(f"Received request to generate slide markdown for course ID: {course_id}")

    course = session.get(Course, course_id)
    if not course:
        logger.error(f"Course {course_id} not found.")
        raise HTTPException(status_code=404, detail="Course not found")

    if not course.lessons:
        logger.warning(f"Course {course_id} has no lessons, no slides to generate.")
        return Response(status_code=204)

    background_tasks.add_task(
        run_generate_course_markdown_task,
        course_id=course_id
    )

    logger.info(f"Added background task for generating slide markdown for course {course_id}")
    return Response(status_code=204)


#######################
# CRUD ENDPOINTS
#######################

@router.get("/sections/{section_id}/slides/pptx", response_class=StreamingResponse, tags=["Slides"])
async def get_section_slides_pptx_endpoint(section_id: int, session: Session = Depends(get_session)):
    """Generate and download a PPTX file containing slide markdown from a section."""
    logger.info(f"Request to download PPTX for section ID: {section_id}")
    
    section = session.exec(
        select(Section).where(Section.id == section_id)
    ).first()
    
    if not section:
        logger.warning(f"Section {section_id} not found for PPTX generation.")
        raise HTTPException(status_code=404, detail="Section not found")
    
    slide = session.exec(
        select(Slide).where(Slide.section_id == section_id)
    ).first()
    
    if not slide or not slide.markdown_content:
        logger.warning(f"No slide markdown found for section {section_id}.")
        raise HTTPException(status_code=404, detail="No slide markdown found for this section")
    
    logger.info(f"Converting markdown to PPTX for section {section_id}")
    
    try:
        pptx_bytes = markdown_to_pptx_bytes(slide.markdown_content)
        logger.info(f"PPTX generated successfully for section {section_id}. Sending response.")
        return pptx_response(pptx_bytes.getvalue(), section.title)
    except Exception as e:
        logger.exception(f"Error generating PPTX for section {section_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate presentation: {e}")


@router.get("/sections/{section_id}/slides", response_model=List[Slide], tags=["Slides"])
async def get_section_slides_endpoint(section_id: int, session: Session = Depends(get_session)):
    """Get all slide markdown content for a section."""
    slides = session.exec(select(Slide).where(Slide.section_id == section_id)).all()
    if not slides:
        return []
    return slides


@router.get("/lessons/{lesson_id}/slides/pptx", response_class=StreamingResponse, tags=["Slides"])
async def get_lesson_slides_pptx_endpoint(lesson_id: int, session: Session = Depends(get_session)):
    """Generate and download a PPTX file containing all slides from a lesson's markdown."""
    logger.info(f"Request to download PPTX for lesson ID: {lesson_id}")
    
    lesson = session.get(Lesson, lesson_id)
    if not lesson:
        logger.warning(f"Lesson {lesson_id} not found for PPTX generation.")
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    slides: list[Slide] = session.exec(
        select(Slide).join(Section)
        .where(Section.lesson_id == lesson_id)
        .order_by(Section.id)
    ).all()
    
    if not slides:
        logger.warning(f"No slide markdown found in any section for lesson {lesson_id}.")
        raise HTTPException(status_code=404, detail="No slide markdown found in this lesson")
    
    markdown_parts = [slide.markdown_content for slide in slides]
    combined_markdown = "\n\n---\n\n".join(markdown_parts)
    
    # Clean up potential duplicate separators (e.g., --- followed by whitespace then ---)
    pattern = re.compile(r'---\s*---')
    while pattern.search(combined_markdown):
        combined_markdown = pattern.sub('---', combined_markdown)
    
    logger.info(f"Generating PPTX for lesson {lesson_id}")
    
    try:
        logger.info(f"Converting final markdown to PPTX bytes for lesson {lesson_id}")
        pptx_bytes = markdown_to_pptx_bytes(combined_markdown)
        
        logger.info(f"PPTX generated successfully for lesson {lesson_id}. Sending response.")
        return pptx_response(pptx_bytes.getvalue(), lesson.title)
    except Exception as e:
        logger.exception(f"Error generating PPTX for lesson {lesson_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate presentation: {e}")


@router.get("/lessons/{lesson_id}/slides", response_model=List[Slide], tags=["Slides"])
async def get_lesson_slides_endpoint(lesson_id: int, session: Session = Depends(get_session)):
    """Get all slide markdown content for a lesson."""
    slides = session.exec(
        select(Slide).join(Section).where(Section.lesson_id == lesson_id).order_by(Section.id)
    ).all()
    return slides


@router.get("/courses/{course_id}/slides/pptx", response_class=StreamingResponse, tags=["Slides"])
async def get_course_slides_pptx_endpoint(course_id: int, session: Session = Depends(get_session)):
    """Generate and download a PPTX file containing all slides from a course's markdown."""
    logger.info(f"Request to download PPTX for course ID: {course_id}")
    course = session.get(Course, course_id)
    if not course:
        logger.warning(f"Course {course_id} not found for PPTX generation.")
        raise HTTPException(status_code=404, detail="Course not found")

    slides: list[Slide] = session.exec(
        select(Slide).join(Section).join(Lesson)
        .where(Lesson.course_id == course_id)
        .order_by(Lesson.id, Section.id)
    ).all()

    if not slides:
        logger.warning(f"No slide markdown found in any section for course {course_id}.")
        raise HTTPException(status_code=404, detail="No slide markdown found in this course")

    markdown_parts = [slide.markdown_content for slide in slides]
    combined_markdown = "\n\n---\n\n".join(markdown_parts)

    # Clean up potential duplicate separators (e.g., --- followed by whitespace then ---)
    pattern = re.compile(r'---\s*---')
    while pattern.search(combined_markdown):
        combined_markdown = pattern.sub('---', combined_markdown)

    logger.info(
        f"Generating PPTX for course {course_id} (download only, AI image generation disabled)"
    )

    try:
        logger.info(f"Converting final markdown to PPTX bytes for course {course_id}")
        pptx_bytes = markdown_to_pptx_bytes(combined_markdown)
        
        logger.info(f"PPTX generated successfully for course {course_id}. Sending response.")
        return pptx_response(pptx_bytes.getvalue(), course.title or course.name)
    except Exception as e:
        logger.exception(f"Error generating PPTX for course {course_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate presentation for course: {e}")


@router.get("/courses/{course_id}/slides", response_model=List[Slide], tags=["Slides"])
async def get_course_slides_endpoint(course_id: int, session: Session = Depends(get_session)):
    """Get all slide markdown content for a course."""
    slides = session.exec(
        select(Slide).join(Section).join(Lesson)
        .where(Lesson.course_id == course_id)
        .order_by(Lesson.id, Section.id)
    ).all()
    return slides


@router.get("/courses/{course_id}/has-slides", response_model=dict, tags=["Slides"])
async def check_course_has_slides_endpoint(course_id: int, session: Session = Depends(get_session)):
    """Check if any slides exist for a given course."""
    logger.info(f"Checking if slides exist for course ID: {course_id}")

    # Count slides linked to the course
    stmt = (
        select(Slide.id) # Select only the ID for efficiency
        .join(Section, Slide.section_id == Section.id)
        .join(Lesson, Section.lesson_id == Lesson.id)
        .where(Lesson.course_id == course_id)
        .limit(1) # We only need to know if at least one exists
    )
    result = session.exec(stmt).first()

    has_slides = result is not None
    logger.info(f"Course {course_id} has slides: {has_slides}")

    return {"has_slides": has_slides}

#######################
# BACKGROUND TASK FUNCTIONS
#######################

def run_generate_section_markdown_task(section_id: int):
    """Background task wrapper to generate slide markdown for a section asynchronously."""
    logger.info(f"[BACKGROUND][run_generate_section_markdown_task][{section_id}] Starting task for section ID: {section_id}")

    async def _actual_generate_section_markdown_task():
        """Asynchronous core logic for generating section slide markdown."""
        logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Entering async core logic.")
        section = None
        course = None
        with Session(engine) as session:
            try:
                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Fetching section and course data.")
                section = session.exec(
                    select(Section).where(Section.id == section_id).options(selectinload(Section.lesson).selectinload(Lesson.course))
                ).first()

                if not section:
                    logger.error(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Section {section_id} not found.")
                    return
                if not section.lesson or not section.lesson.course:
                    logger.error(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Could not retrieve course data for section {section_id}.")
                    return

                course = section.lesson.course
                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Section {section_id} (Course: {course.id}) fetched.")

                course.is_working = True
                session.add(course)
                session.commit()

                language = course.language
                ai_images_flag = course.ai_images

                if not section.content:
                    logger.warning(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Section {section_id} has no content. Skipping markdown generation.")
                    return

                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Deleting existing slide markdown for section {section_id}.")
                delete_stmt = delete(Slide).where(Slide.section_id == section_id)
                session.exec(delete_stmt)
                session.commit()
                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Deleted existing slide markdown records.")

                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Generating markdown (ai_images flag={ai_images_flag}).")
                input_content_for_ai = f"# {section.title}\n\n{section.content}" if section.title else section.content
                # Always request image placeholders from LLM so we can generate visuals
                markdown_result = await write_presentation_markdown(input_content_for_ai, language=language, ai_images=ai_images_flag)

                # If AI images are enabled for this course, process the markdown to
                # generate the referenced images and rewrite their paths. When
                # `ai_images_flag` is False we *skip* this step entirely — we do
                # not parse the markdown for image links nor trigger any image
                # generation to honour the course configuration.
                if ai_images_flag and markdown_result:
                    markdown_result = await generate_ai_images_for_markdown(markdown_result)

                # Fix compilation issues (e.g., missing images) if any
                if markdown_result:
                    markdown_result = await improve_slides(markdown_result)

                if markdown_result:
                    logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Saving generated markdown.")
                    new_slide = Slide(
                        section_id=section.id,
                        markdown_content=markdown_result
                    )
                    session.add(new_slide)
                    session.commit()
                    logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Committed new slide markdown.")
                else:
                    logger.warning(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] No markdown generated by AI.")

                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Generate slide markdown task completed for section ID: {section_id}")

            except Exception as e:
                logger.exception(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Error in async task for section {section_id}: {e}")
            finally:
                logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Entering finally block.")
                if session.is_active:
                    course_id_to_update = course.id if course else None
                    if course_id_to_update:
                        try:
                            stmt = update(Course).where(Course.id == course_id_to_update).values(is_working=False)
                            session.exec(stmt)
                            session.commit()
                            logger.info(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Committed is_working=False for course {course_id_to_update}.")
                        except Exception as finally_e:
                            logger.error(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Error setting is_working=False in finally block: {finally_e}")
                            session.rollback()
                    else:
                         logger.warning(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Could not determine course ID in finally block.")
                else:
                    logger.warning(f"[BACKGROUND][_actual_generate_section_markdown_task][{section_id}] Session inactive in finally block.")

    try:
        logger.info(f"[BACKGROUND][run_generate_section_markdown_task][{section_id}] Running async core logic.")
        asyncio.run(_actual_generate_section_markdown_task())
        logger.info(f"[BACKGROUND][run_generate_section_markdown_task][{section_id}] Async core logic finished.")
    except Exception as e:
        logger.error(f"[BACKGROUND][run_generate_section_markdown_task][{section_id}] Top-level error running task for section {section_id}: {e}")
    finally:
         logger.info(f"[BACKGROUND][run_generate_section_markdown_task][{section_id}] Background task execution finished for section {section_id}.")


def run_generate_lesson_markdown_task(lesson_id: int):
    """Background task wrapper to generate slide markdown for all sections in a lesson asynchronously."""
    logger.info(f"[BACKGROUND][run_generate_lesson_markdown_task][{lesson_id}] Starting task for lesson ID: {lesson_id}")

    async def _actual_generate_lesson_markdown_task():
        """Asynchronous core logic for generating lesson slide markdown."""
        logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Entering async core logic.")
        lesson = None
        course = None
        with Session(engine) as session:
            try:
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Fetching lesson, sections, and course data.")
                lesson = session.exec(
                    select(Lesson).where(Lesson.id == lesson_id).options(selectinload(Lesson.sections), selectinload(Lesson.course))
                ).first()

                if not lesson:
                    logger.error(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Lesson {lesson_id} not found.")
                    return
                if not lesson.course:
                    logger.error(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Course data not found for lesson {lesson_id}.")
                    return
                if not lesson.sections:
                    logger.warning(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Lesson {lesson_id} has no sections. Skipping.")
                    return

                course = lesson.course
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Lesson {lesson_id} (Course: {course.id}) fetched with {len(lesson.sections)} sections.")

                course.is_working = True
                session.add(course)
                session.commit()
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Set is_working=True for course {course.id}.")

                language = course.language
                ai_images_flag = course.ai_images

                sections_to_process = [sec for sec in lesson.sections if sec.content]
                section_ids_to_clear = [sec.id for sec in sections_to_process]

                if not sections_to_process:
                    logger.warning(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] No sections with content found in lesson {lesson_id}.")
                    return

                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Deleting existing slide markdown for {len(section_ids_to_clear)} sections.")
                delete_stmt = delete(Slide).where(Slide.section_id.in_(section_ids_to_clear))
                session.exec(delete_stmt)
                session.commit()
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Deleted existing slide markdown records.")

                ai_tasks = []
                section_map = {}
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Creating {len(sections_to_process)} markdown generation tasks.")
                for section in sections_to_process:
                    input_content_for_ai = f"# {section.title}\n\n{section.content}" if section.title else section.content
                    async def _task_wrapper(content=input_content_for_ai):
                        md = await write_presentation_markdown(content, language=language, ai_images=ai_images_flag)
                        if ai_images_flag and md:
                            md = await generate_ai_images_for_markdown(md)
                        if md:
                            md = await improve_slides(md)
                        return md

                    task = _task_wrapper()
                    ai_tasks.append(task)
                    section_map[task] = section.id

                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Gathering results for {len(ai_tasks)} tasks.")
                markdown_results = await asyncio.gather(*ai_tasks, return_exceptions=True)
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Finished gathering results.")

                processed_sections_count = 0
                failed_sections_count = 0
                for i, result in enumerate(markdown_results):
                    task_future = ai_tasks[i]
                    section_id = section_map.get(task_future)
                    if section_id is None:
                         logger.error(f"Could not map result index {i} back to section_id for lesson {lesson_id}")
                         failed_sections_count += 1
                         continue

                    if isinstance(result, Exception):
                        logger.error(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Failed to generate markdown for section {section_id}: {result}")
                        failed_sections_count += 1
                    elif result:
                        processed_sections_count += 1
                        logger.debug(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Saving markdown for section {section_id}.")
                        new_slide = Slide(
                            section_id=section_id,
                            markdown_content=result
                        )
                        session.add(new_slide)
                    else:
                         logger.warning(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] No markdown generated for section {section_id}.")
                         failed_sections_count += 1

                if processed_sections_count > 0:
                    session.commit()
                    logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Committed markdown for {processed_sections_count} sections.")
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Task completed. Processed: {processed_sections_count}, Failed: {failed_sections_count}.")

            except Exception as e:
                logger.exception(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Error in async task for lesson {lesson_id}: {e}")
            finally:
                logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Entering finally block.")
                if session.is_active:
                    course_id_to_update = course.id if course else None
                    if course_id_to_update:
                        try:
                             stmt = update(Course).where(Course.id == course_id_to_update).values(is_working=False)
                             session.exec(stmt)
                             session.commit()
                             logger.info(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Committed is_working=False for course {course_id_to_update}.")
                        except Exception as finally_e:
                             logger.error(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Error setting is_working=False in finally block: {finally_e}")
                             session.rollback()
                    else:
                         logger.warning(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Could not determine course ID in finally block.")
                else:
                    logger.warning(f"[BACKGROUND][_actual_generate_lesson_markdown_task][{lesson_id}] Session inactive in finally block.")

    try:
        logger.info(f"[BACKGROUND][run_generate_lesson_markdown_task][{lesson_id}] Running async core logic.")
        asyncio.run(_actual_generate_lesson_markdown_task())
        logger.info(f"[BACKGROUND][run_generate_lesson_markdown_task][{lesson_id}] Async core logic finished.")
    except Exception as e:
        logger.error(f"[BACKGROUND][run_generate_lesson_markdown_task][{lesson_id}] Top-level error running task for lesson {lesson_id}: {e}")
    finally:
        logger.info(f"[BACKGROUND][run_generate_lesson_markdown_task][{lesson_id}] Background task execution finished for lesson {lesson_id}.")


def run_generate_course_markdown_task(course_id: int):
    """Background task wrapper to generate slide markdown for all sections in a course asynchronously."""
    logger.info(f"[BACKGROUND][run_generate_course_markdown_task][{course_id}] Starting task for course ID: {course_id}")

    async def _actual_generate_course_markdown_task():
        """Asynchronous core logic for generating course slide markdown."""
        logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Entering async core logic.")
        course_with_lessons = None
        with Session(engine) as session:
            try:
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Fetching course, lessons, and sections data.")
                course_with_lessons = session.exec(
                    select(Course).where(Course.id == course_id).options(
                        selectinload(Course.lessons).selectinload(Lesson.sections)
                    )
                ).first()

                if not course_with_lessons:
                    logger.error(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Course {course_id} not found.")
                    return
                if not course_with_lessons.lessons:
                    logger.warning(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Course {course_id} has no lessons. Skipping.")
                    return
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Course {course_id} fetched.")

                course_with_lessons.is_working = True
                session.add(course_with_lessons)
                session.commit()
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Set is_working=True for course {course_id}.")

                language = course_with_lessons.language
                ai_images_flag = course_with_lessons.ai_images

                sections_to_process = []
                section_ids_to_clear = []
                for lesson in course_with_lessons.lessons:
                    for section in lesson.sections:
                        if section.content:
                            sections_to_process.append(section)
                            section_ids_to_clear.append(section.id)

                if not sections_to_process:
                    logger.warning(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] No sections with content found in course {course_id}.")
                    return

                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Deleting existing slide markdown for {len(section_ids_to_clear)} sections.")
                if section_ids_to_clear:
                    delete_stmt = delete(Slide).where(Slide.section_id.in_(section_ids_to_clear))
                    session.exec(delete_stmt)
                    session.commit()
                    logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Deleted existing slide markdown records.")

                ai_tasks = []
                section_map = {}
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Creating {len(sections_to_process)} markdown generation tasks.")
                for section in sections_to_process:
                    input_content_for_ai = f"# {section.title}\n\n{section.content}" if section.title else section.content
                    async def _task_wrapper(content=input_content_for_ai):
                        md = await write_presentation_markdown(content, language=language, ai_images=ai_images_flag)
                        if ai_images_flag and md:
                            md = await generate_ai_images_for_markdown(md)
                        if md:
                            md = await improve_slides(md)
                        return md

                    task = _task_wrapper()
                    ai_tasks.append(task)
                    section_map[task] = section.id

                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Gathering results for {len(ai_tasks)} tasks.")
                markdown_results = await asyncio.gather(*ai_tasks, return_exceptions=True)
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Finished gathering results.")

                processed_sections_count = 0
                failed_sections_count = 0
                for i, result in enumerate(markdown_results):
                    task_future = ai_tasks[i]
                    section_id = section_map.get(task_future)
                    if section_id is None:
                         logger.error(f"Could not map result index {i} back to section_id for course {course_id}")
                         failed_sections_count += 1
                         continue

                    if isinstance(result, Exception):
                        logger.error(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Failed to generate markdown for section {section_id}: {result}")
                        failed_sections_count += 1
                    elif result:
                        processed_sections_count += 1
                        logger.debug(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Saving markdown for section {section_id}.")
                        new_slide = Slide(
                            section_id=section_id,
                            markdown_content=result
                        )
                        session.add(new_slide)
                    else:
                         logger.warning(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] No markdown generated for section {section_id}.")
                         failed_sections_count += 1

                if processed_sections_count > 0:
                    session.commit()
                    logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Committed markdown for {processed_sections_count} sections.")
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Task completed. Processed: {processed_sections_count}, Failed: {failed_sections_count}.")

            except Exception as e:
                logger.exception(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Error in async task for course {course_id}: {e}")
            finally:
                logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Entering finally block.")
                if session.is_active:
                    course_id_to_update = course_id
                    try:
                         stmt = update(Course).where(Course.id == course_id_to_update).values(is_working=False)
                         session.exec(stmt)
                         session.commit()
                         logger.info(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Committed is_working=False for course {course_id_to_update}.")
                    except Exception as finally_e:
                         logger.error(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Error setting is_working=False in finally block: {finally_e}")
                         session.rollback()
                else:
                     logger.warning(f"[BACKGROUND][_actual_generate_course_markdown_task][{course_id}] Session inactive in finally block.")

    try:
        logger.info(f"[BACKGROUND][run_generate_course_markdown_task][{course_id}] Running async core logic.")
        asyncio.run(_actual_generate_course_markdown_task())
        logger.info(f"[BACKGROUND][run_generate_course_markdown_task][{course_id}] Async core logic finished.")
    except Exception as e:
        logger.error(f"[BACKGROUND][run_generate_course_markdown_task][{course_id}] Top-level error running task for course {course_id}: {e}")
    finally:
        logger.info(f"[BACKGROUND][run_generate_course_markdown_task][{course_id}] Background task execution finished for course {course_id}.")
