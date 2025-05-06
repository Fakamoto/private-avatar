from pathlib import Path
from typing import Type, List, Tuple
import re
from agentics import Embedding
from pydantic import BaseModel, Field, create_model
from PyPDF2 import PdfReader
from io import BytesIO
import io
from fastapi import UploadFile
from fastapi.responses import StreamingResponse
import urllib.parse

from pydantic import model_validator

import tempfile, os, pypandoc

# Add missing standard library imports used later in the file
import subprocess, textwrap

import logging # Add logging import

# Add logger setup at the top level of the module
logger = logging.getLogger("utils")
logger.setLevel(logging.INFO) # Or set level as needed

# File utilities
SAFE_CHARS = r'[\\/*?:"<>|]'

def sanitize_filename(text: str, max_len: int = 100) -> str:
    """
    Sanitize a filename by removing unsafe characters and limiting length.
    
    Args:
        text: The raw text to sanitize
        max_len: Maximum allowed filename length
        
    Returns:
        Sanitized filename string
    """
    text = text.strip()
    text = re.sub(SAFE_CHARS, '', text)
    text = re.sub(r'\s+', ' ', text)
    return text[:max_len]

def pptx_response(data: bytes, raw_title: str) -> StreamingResponse:
    """
    Create a StreamingResponse for a PPTX file with proper headers.
    
    Args:
        data: The PPTX file data as bytes
        raw_title: The unsanitized title to use for the filename
        
    Returns:
        StreamingResponse configured for PPTX download
    """
    safe_title = sanitize_filename(raw_title or "slides")
    fname = f"{safe_title}.pptx"
    
    # Simple Content-Disposition header with both ASCII and UTF-8 filenames
    cd = f'attachment; filename="{fname}"; filename*=UTF-8\'\'{urllib.parse.quote(fname)}'
    
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": cd},
    )

class SectionTimeStructure(BaseModel):
    duration_minutes: int = Field(description="Duration of this section in minutes. Ensure realistic allocation based on the lesson's total duration.")
    words: int = Field(default=None, exclude=True)

    def __init__(self, **data):
        super().__init__(**data)
        self.calculate_words(words_per_minute=100)

    def calculate_words(self, words_per_minute: int = 100):
        self.words = self.duration_minutes * words_per_minute

class LessonTimeStructure(BaseModel):
    duration_minutes: int = Field(description="Total duration of this lesson in minutes. Ensure the sum of all section durations exactly matches this duration.")
    number_of_sections: int = Field(description="Number of sections this lesson must contain. Ensure the sections list matches this number exactly.")
    sections: list[SectionTimeStructure] = Field(
        default_factory=list,
        description="List of sections within this lesson. The sum of all section durations must exactly equal the lesson's total duration. Each section must have a realistic duration allocation."
    )

    @model_validator(mode='after')
    def validate_sections(self):
        if len(self.sections) != self.number_of_sections:
            raise ValueError(f"Number of sections provided ({len(self.sections)}) does not match the expected number ({self.number_of_sections}).")
        total_section_minutes = sum(section.duration_minutes for section in self.sections)
        if total_section_minutes != self.duration_minutes:
            raise ValueError(f"Sum of section durations ({total_section_minutes} min) does not match lesson duration ({self.duration_minutes} min).")
        return self

class CourseTimeStructure(BaseModel):
    duration_minutes: int = Field(description="Total duration of the entire course in minutes. Ensure the sum of all lesson durations exactly matches this duration.")
    number_of_lessons: int = Field(description="Exact number of lessons the course must contain. Ensure the lessons list matches this number exactly.")
    lessons: list[LessonTimeStructure] = Field(
        description="List of lessons within the course. The sum of all lesson durations must exactly equal the course's total duration. Each lesson must have a realistic duration allocation. For example, if the course duration is 120 minutes and the number_of_lessons is 4, you must create exactly 4 lessons whose durations sum precisely to 120 minutes."
    )

    @model_validator(mode='after')
    def validate_lessons(self):
        if len(self.lessons) != self.number_of_lessons:
            raise ValueError(f"Number of lessons provided ({len(self.lessons)}) does not match the expected number ({self.number_of_lessons}).")
        total_lesson_minutes = sum(lesson.duration_minutes for lesson in self.lessons)
        if total_lesson_minutes != self.duration_minutes:
            raise ValueError(f"Sum of lesson durations ({total_lesson_minutes} min) does not match course duration ({self.duration_minutes} min).")
        return self
    
    @classmethod
    def default(cls, duration_minutes: int):
        SECTION_MINUTES = 5
        LESSON_MAX_MINUTES = 60
        SECTIONS_PER_FULL_LESSON = LESSON_MAX_MINUTES // SECTION_MINUTES

        if duration_minutes % SECTION_MINUTES:
            raise ValueError("Total minutes must be a multiple of 5.")

        full_lesson_count, remainder_minutes = divmod(duration_minutes, LESSON_MAX_MINUTES)

        lessons = [
            LessonTimeStructure(
                duration_minutes=LESSON_MAX_MINUTES,
                number_of_sections=SECTIONS_PER_FULL_LESSON,
                sections=[
                    SectionTimeStructure(duration_minutes=SECTION_MINUTES)
                    for _ in range(SECTIONS_PER_FULL_LESSON)
                ],
            )
            for _ in range(full_lesson_count)
        ]

        if remainder_minutes:
            sections_in_last_lesson = remainder_minutes // SECTION_MINUTES
            lessons.append(
                LessonTimeStructure(
                    duration_minutes=remainder_minutes,
                    number_of_sections=sections_in_last_lesson,
                    sections=[
                        SectionTimeStructure(duration_minutes=SECTION_MINUTES)
                        for _ in range(sections_in_last_lesson)
                    ],
                )
            )

        return cls(
            duration_minutes=duration_minutes,
            number_of_lessons=len(lessons),
            lessons=lessons,
        )

def dynamic_model(cls: Type[BaseModel]) -> Type[BaseModel]:
    """
    Decorator for Pydantic models that flattens list fields with count parameter.

    Example:
        from agentics import LLM

        @dynamic_model
        class Babies(BaseModel):
            country: str
            names: list[str] = Field(count=3)  # Will create names_1, names_2, names_3

        llm = LLM()
        babies = llm("List popular baby names", response_format=Babies)

        print(babies.names)  # ['Olivia', 'Liam', 'Emma']
        print(babies.model_dump())  # {'country': 'USA', 'names': ['Olivia', 'Liam', 'Emma']}
    """
    fields = {}
    original_fields = {}

    for field_name, field_type in cls.__annotations__.items():
        field_info = cls.model_fields[field_name]

        if getattr(field_type, "__origin__", None) is list:
            count = None
            if (
                hasattr(field_info, "json_schema_extra")
                and field_info.json_schema_extra
            ):
                count = field_info.json_schema_extra.get("count")

            if count is not None:
                # Store original field info
                original_fields[field_name] = (field_type, count)
                # Create numbered fields
                for i in range(1, count + 1):
                    numbered_field = f"{field_name}_{i}"
                    field_params = {}
                    if field_info.description:
                        field_params["description"] = field_info.description
                    fields[numbered_field] = (str, Field(**field_params))
            else:
                fields[field_name] = (field_type, field_info)
        else:
            fields[field_name] = (field_type, field_info)

    # Create new model class
    NewModel = create_model(cls.__name__, **fields)

    # Store original model info
    setattr(NewModel, "_original_fields", original_fields)

    # Add property getters for list fields
    for base_name, (field_type, count) in original_fields.items():

        def get_list(self, name=base_name):
            return [getattr(self, f"{name}_{i}") for i in range(1, count + 1)]

        setattr(NewModel, base_name, property(get_list))

    # Override model_dump to return original format
    def model_dump(self, *args, **kwargs):
        result = {}
        for field_name in self.model_fields:
            if "_" in field_name and field_name.split("_")[-1].isdigit():
                continue
            if field_name in original_fields:
                result[field_name] = getattr(self, field_name)
            else:
                result[field_name] = getattr(self, field_name)
        return result

    NewModel.model_dump = model_dump

    return NewModel

async def get_file_content(file: UploadFile) -> str:
    """Extract text content from PDF and text files."""
    ext = Path(file.filename).suffix.lower()
    content = await file.read()

    if ext == ".pdf":
        text_content = []
        pdf = PdfReader(BytesIO(content))
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_content.append(text)
        return "\n\n".join(text_content)
    else:
        return content.decode("utf-8")

class Chunk(BaseModel):
    chunk: str = Field(description="The chunk of the content")
    embedding: list[float] = Field(description="The embedding of the chunk")

class Chunks(BaseModel):
    chunks: list[Chunk] = Field(description="A list of chunks")

    @classmethod
    def get_chunks(
        cls, file_content: str, chunk_size: int = 5000, chunk_overlap: int = 500
    ) -> "Chunks":
        """
        Split file_content into overlapping chunks and generate embeddings for each chunk.

        Args:
            file_content (str): The full text content from a file.
            chunk_size (int, optional): Maximum size of each chunk. Defaults to 500.
            chunk_overlap (int, optional): Number of characters to overlap between chunks. Defaults to 50.

        Returns:
            Chunks: An instance of Chunks containing a list of Chunk objects with text and embeddings.
        """
        assert file_content, "File content can not be empty"
        embedder = Embedding(model="text-embedding-3-small")
        chunks_list = []
        start = 0
        content_length = len(file_content)
        while start < content_length:
            end = start + chunk_size
            chunk_text = file_content[start:end]
            chunks_list.append(chunk_text)
            start += max(chunk_size - chunk_overlap, 1)

        embeddings = embedder.embed(chunks_list)

        chunk_objects = [
            Chunk(chunk=chunk, embedding=embedding)
            for chunk, embedding in zip(chunks_list, embeddings)
        ]
        return cls(chunks=chunk_objects)

    def order_by_similarity(
        self, query: str, threshold: float = 0.0, top_k: int = 10
    ) -> list[str]:
        """
        Rank the text chunks by cosine similarity to the provided query text.

        This method computes the embedding for the query and leverages vectorized
        operations (using the Embedding.rank method) to rank all chunk embeddings.

        Args:
            query (str): The input text to compare against chunk embeddings.
            threshold (float, optional): The minimum similarity score required for a chunk to be included.
                                         Defaults to 0.0.

        Returns:
            list[str]: A list of chunk texts ordered from most to least similar that meet the threshold.
        """
        assert query, "Query can not be empty"
        embedder = Embedding(model="text-embedding-3-small")
        query_embedding = embedder.embed(query)
        candidate_embeddings = [chunk.embedding for chunk in self.chunks]
        ranking = embedder.rank(
            query_embedding, candidate_embeddings, return_vectors=False
        )
        results = []
        for idx, similarity_score in ranking:
            if similarity_score >= threshold:
                results.append(self.chunks[idx].chunk)
            if len(results) == top_k:
                break
        return results

def markdown_to_pptx_bytes(markdown: str, reference_doc: str = None) -> BytesIO:
    """
    Convert a markdown string to a temporary PPTX file and return a BytesIO object.
    """
    # Use pypandoc to convert to PPTX in temporary file
    tmp_md = tempfile.NamedTemporaryFile(delete=False, suffix=".md")
    pptx_file_path = tmp_md.name.replace(".md", ".pptx")
    tmp_md.write(markdown.encode("utf-8"))
    tmp_md.close()

    # Ensure the image directory exists (it should, but doesn't hurt to check)
    image_dir = Path("/data/images")
    image_dir.mkdir(parents=True, exist_ok=True)

    # Pandoc resource path: include both current working directory ("." -> markdown dir)
    # and the absolute images directory so that images referenced like
    # ![](data/images/...) or ![](/data/images/...) are found during conversion.
    resource_path = f".:/data:{image_dir.as_posix()}"
    extra_args = ["--slide-level=0", f"--resource-path={resource_path}", "--mathjax"]
    if reference_doc is not None:
        extra_args.append(f"--reference-doc={reference_doc}")

    # Use absolute path for output to avoid ambiguity
    project_root = Path(".")
    pptx_file_path_abs = project_root / Path(pptx_file_path).name

    logger.debug(f"Running Pandoc: Source={tmp_md.name}, Output={pptx_file_path_abs}, Args={extra_args}")
    try:
        pypandoc.convert_file(tmp_md.name, to="pptx", format="markdown", outputfile=str(pptx_file_path_abs), extra_args=extra_args)
    except Exception as pandoc_err:
        logger.error(f"Pandoc conversion failed: {pandoc_err}")
        # Clean up temporary markdown file even on error
        try:
            os.remove(tmp_md.name)
        except OSError as rm_err:
            logger.warning(f"Could not remove temporary markdown file {tmp_md.name}: {rm_err}")
        raise # Re-raise the pandoc error

    # Read the generated PPTX
    try:
        with open(pptx_file_path_abs, "rb") as f:
            pptx_bytes = BytesIO(f.read())
    except Exception as read_err:
        logger.error(f"Failed to read generated PPTX file {pptx_file_path_abs}: {read_err}")
        raise # Re-raise read error
    finally:
        # Clean up both temporary files
        try:
            os.remove(tmp_md.name)
        except OSError as rm_err:
            logger.warning(f"Could not remove temporary markdown file {tmp_md.name}: {rm_err}")
        try:
            os.remove(pptx_file_path_abs)
        except OSError as rm_err:
            logger.warning(f"Could not remove temporary pptx file {pptx_file_path_abs}: {rm_err}")

    pptx_bytes.seek(0)
    logger.debug(f"Pandoc conversion successful. Returning PPTX bytes.")
    return pptx_bytes

def save_pptx(pptx_bytes: BytesIO, name: str = "presentation"):
    """
    Save a PPTX file to the current directory.
    """
    with open(f"{name}.pptx", "wb") as f:
        f.write(pptx_bytes.getbuffer())

def extract_image_alts_and_paths(markdown: str) -> List[Tuple[str, str]]:
    """
    Returns list of (alt_text, path) for markdown images,
    skips any URL (http:// or https://).
    """
    pattern = (
        r'!\[([^]]*?)\]'          # alt text (can be empty)
        r'\(\s*'                   # opening parenthesis + optional leading whitespace
        r'(?!https?://)'             # ensure not a full URL (skip http/https)
        r'([^)\s]+)'                # capture the path up to whitespace or )
        r'\s*\)'                   # optional whitespace then closing parenthesis – NO mandatory newline
    )
    results = []
    for match in re.finditer(pattern, markdown):
        alt, path = match.groups()
        results.append((alt, path))
    return results

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

# ---------------------------------------------------------------------------
# Quick Markdown math delimiter sanity-check
# ---------------------------------------------------------------------------


def markdown_math_ok(md: str) -> tuple[bool, str]:
    """Light-weight validator to catch common `$` / `$$` delimiter mistakes.

    It mimics KaTeX/markdown render rules (inline math via ``$..$`` and display
    math via ``$$`` on its own lines) sufficiently to detect everyday errors
    that *do* compile under LaTeX but break the React front-end renderer.

    Parameters
    ----------
    md : str
        The markdown string to check.

    Returns
    -------
    ok : bool
        ``True`` if *no* issue was detected.
    log : str
        Concatenated list of human-readable issues (one per line) or an empty
        string when *ok* is ``True``.
    """

    issues: list[str] = []

    def _log(ln: int, msg: str):
        issues.append(f"L{ln}: {msg}")

    double_dollar_lines = []  # record line numbers containing a bare "$$"
    single_dollar_count = 0   # we will compute parity after stripping $$ pairs

    # Pre-processing: remove escaped dollars so they are not counted later
    if r"\$" in md:
        # report but also strip from further counting
        for ln, line in enumerate(md.splitlines(), 1):
            if r"\$" in line:
                _log(ln, "literal `\\$` found – should be plain `$` in math")
        md_no_esc = md.replace(r"\$", "")
    else:
        md_no_esc = md

    # Replace all $$ pairs (whether valid or not) with a sentinel so that
    # single-dollar counting later ignores them.
    tmp = md_no_esc.replace("$$", "")
    single_dollar_count = tmp.count("$")

    # line-based scan for $$ rules/mistakes
    for ln_no, line in enumerate(md_no_esc.splitlines(), 1):
        stripped = line.lstrip()

        if "$$" in line:
            # Condition 1: $$ must sit alone at column 0
            if not line.startswith("$$"):
                _log(ln_no, "indented `$$` – must start at column 0")
            if line.strip() != "$$":
                _log(ln_no, "`$$` must be the only text on its line")

            # Condition 4: $$ not inside list-item or quote
            if stripped[:1] in "-*+>" or re.match(r"\d+\. ", stripped):
                _log(ln_no, "`$$` inside list / quote – use inline `$…$` instead")

            # Record for parity check
            if line.strip() == "$$":
                double_dollar_lines.append(ln_no)

            # Condition 5: mixed $$ … $ within same line
            if re.search(r"\$\$[^$]*\$(?!\$)", line) or re.search(r"\$[^$]*\$\$", line):
                _log(ln_no, "mixed `$$ … $` or `$ … $$` on same line")

    # Condition 2: `$$` parity – needs even number of bare $$ lines
    if len(double_dollar_lines) % 2:
        _log(0, "unmatched `$$` (odd number of stand-alone lines)")

    # Condition 3: single `$` parity (after $$ removal)
    if single_dollar_count % 2:
        _log(0, "unmatched single `$`")

    ok = len(issues) == 0
    return ok, "\n".join(issues)