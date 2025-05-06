import asyncio
import os
from typing import Optional, Literal
from enum import Enum
from backend.local_agentics import ALLM
from pydantic import BaseModel, Field, validator
from backend.utils import dynamic_model, CourseTimeStructure, LessonTimeStructure, latex_ok, markdown_math_ok
import logging
import httpx
from openai import AsyncOpenAI
import tempfile
import subprocess
from PIL import Image
import base64
from io import BytesIO
import re

shared_http_client = httpx.AsyncClient(limits=httpx.Limits(max_connections=100, max_keepalive_connections=20))
shared_openai_client = AsyncOpenAI(http_client=shared_http_client)

FAST_MODEL = os.getenv("FAST_MODEL", "gpt-4.1-mini")
SMART_MODEL = os.getenv("SMART_MODEL", "gpt-4.1-mini")

logger = logging.getLogger("ai")


#######################
# PYDANTIC MODELS
#######################


class SectionInformation(BaseModel):
    short_description: str = Field(
        description="A single sentence that describes what this section is about"
    )
    duration_minutes: int = Field(
        description="Specifies the duration of the section in minutes"
    )
    style: str = Field(
        description="Style guidelines for writing the section based on lesson requirements"
    )
    instructions: str = Field(
        description="Detailed instructions for the AI to create the section content, this is the most important field, add everything you want to transmit to the writer. Add topics, style, tone, information it needs to include, advice on what to write, etc. This field should be long, very long."
    )

class StructuredLessonPlan(BaseModel):
    general_plan: str = Field(description="A general plan for the lesson, think of the things you want to achieve with the lesson, think of the things we want to write, etc, and write it here.")
    sections: list[SectionInformation] = Field(
        description="Planning for each section to be created"
    )


class CoursePlan(BaseModel):
    title_for_course: str = Field(description="The title of the course")
    title_for_lesson: list[str] = Field(description="The title of the lesson")
    prompt_for_lesson: list[str] = Field(
        description="Rich, detailed instructional prompt for generating an individual lesson plan"
    )
    slide_preset: str = Field(
        description="Preset for slides. Choose one from the following options: [professional, creative, minimalist, earthy, tech, vibrant, serene, futuristic, organic, luxury]"
    )
    @validator("slide_preset", pre=True, always=True)
    def normalize_slide_preset(cls, v: str) -> str:
        return v.lower() if isinstance(v, str) else v


class LessonPlan(BaseModel):
    section_plan: list[str] = Field(description="Content for section plan")


class LessonGeneration(BaseModel):
    title_for_section: list[str] = Field(description="The title for the section")
    content_for_section: list[str] = Field(description="Content for section")


#######################
# AI
#######################
async def generate_time_structure(prompt: str, total_duration_minutes: int, retry: int = 3):
    func_name = "generate_time_structure"
    logger.info(f"[{func_name}] Starting generation for total duration: {total_duration_minutes} min. Max retries: {retry}.")
    logger.debug(f"[{func_name}] Prompt: '{prompt[:100]}...'")

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an AI assistant specializing in course time allocation.
Your task is to determine an optimal time structure (number of lessons and duration per lesson) for a course based on a user prompt and total duration.
</RoleAndObjective>
"""

    STRUCTURE_DEFINITION = """
<StructureDefinition>
Define `CourseTimeStructure` model:
  - `number_of_lessons` (int): total count of lessons.
  - `total_duration_minutes` (int): sum of all lesson durations.
  - `lessons` (list of `LessonTimeStructure`).

Define `LessonTimeStructure` model:
  - `lesson_index` (int): index of this lesson (starting at 1).
  - `duration_minutes` (int): duration of this lesson.
  - `sections` (list of `SectionTimeStructure`).

Define `SectionTimeStructure` model:
  - `section_index` (int): index of this section (starting at 1 within the lesson).
  - `duration_minutes` (int): duration of this section (max 5 minutes each unless otherwise specified).
</StructureDefinition>
"""

    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze Input:** Evaluate the user prompt (`<UserPrompt>`) for topic complexity and scope, considering the total duration (`<TotalDurationMinutes>`).
        2.  **Determine Lesson Count:** Decide a reasonable `number_of_lessons` based on complexity, total duration, and time allocation guidelines.
        3.  **Allocate Lesson Durations:** Distribute the `total_duration_minutes` across the determined `number_of_lessons` to create a list of `duration_minutes` for each lesson.
        4.  **Break Down Lessons into Sections:** For *each* lesson generated in the previous step, break its `duration_minutes` into sections, ensuring each section's `duration_minutes` is no more than 5 minutes (unless specified otherwise).
        5.  **Validate Counts and Sums:** Ensure the sum of lesson `duration_minutes` *exactly* equals `total_duration_minutes`. Ensure the number of lesson objects in the `lessons` list *exactly* matches `number_of_lessons`.
        6.  **Adhere to Format:** Ensure the final output strictly follows the `CourseTimeStructure` Pydantic model, including the nested sections for each lesson.
    </General>
</Instructions>
"""

    DETAILED_TIME_GUIDANCE = """
<DetailedTimeGuidance>
    <Guideline>General guidelines for typical educational content (use for reasoning, not as hard limits): Lessons are often 10-60 minutes long.</Guideline>
    <Guideline>Sections within each lesson should be no longer than 5 minutes each, unless explicitly specified otherwise. For longer lessons (e.g., 60 minutes), break content into multiple 3-5 minute sections rather than fewer long sections.</Guideline>
    <Guideline>Consider the prompt's complexity and the total course duration when deciding how many lessons are appropriate. A complex topic or longer total duration might warrant more lessons.</Guideline>
</DetailedTimeGuidance>
"""

    CONSTRAINTS = """
<Constraints>
    <Constraint name="TotalDurationMatch">The sum of the list of individual lesson `duration_minutes` *must* exactly equal the provided `total_duration_minutes`.</Constraint>
    <Constraint name="ReasonableStructure">The `number_of_lessons`, lesson durations, and section durations should be logical. Avoid overly short or excessively long lessons unless the total duration is very small or very large.</Constraint>
    <Constraint name="SectionMaxLength">Each section's `duration_minutes` should not exceed 5 minutes unless the user has explicitly requested longer sections.</Constraint>
    <Constraint name="LessonCountMatch">The `number_of_lessons` field value MUST EXACTLY match the number of lesson objects in the `lessons` list. This is critical and validation will fail if there's a mismatch.</Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the CourseTimeStructure Pydantic model structure (`number_of_lessons`, `duration_minutes` list, `total_duration_minutes`, and nested `lessons` with `sections`).
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step:
1. Analyze prompt complexity & total duration.
2. Estimate a reasonable number of lessons (`number_of_lessons`).
3. Distribute `total_duration_minutes` among the estimated lessons to get individual `duration_minutes` for each lesson.
4. *For each lesson*: Break down its allocated `duration_minutes` into sections, ensuring each section is <= 5 minutes.
5. Verify sum of lesson durations == `total_duration_minutes`.
6. Verify the count of generated lesson objects matches `number_of_lessons`.
7. Assemble the full nested structure and format the output.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Compose System Prompt (once) ---
    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        STRUCTURE_DEFINITION,
        INSTRUCTIONS_CORE,
        CONSTRAINTS,
        OUTPUT_FORMAT,
        THINKING_PROCESS,
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    llm = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)
    last_error_message = None  # Variable to store the error from the previous iteration

    for i in range(retry):
        logger.info(f"[{func_name}] Attempt {i+1}/{retry}")
        # --- Dynamic Snippets (inside loop) ---
        user_prompt_input = f"<UserPrompt>{prompt}</UserPrompt>"
        total_duration_input = f"<TotalDurationMinutes>{total_duration_minutes}</TotalDurationMinutes>"
        retry_context_input = ""
        if last_error_message:
            logger.warning(f"[{func_name}] Previous attempt failed: {last_error_message}. Adding context to retry.")
            retry_context_input = f"""<RetryContext>
The previous attempt failed with the following error:
"{last_error_message}"

Please carefully review and correct the output based on these critical requirements:
*   **Total Duration Match:** The sum of `duration_minutes` for all lessons in the `lessons` list MUST equal the requested `total_duration_minutes`.
*   **Lesson Count Match:** The `number_of_lessons` field MUST EXACTLY match the actual number of lesson objects in the `lessons` list (e.g., if `number_of_lessons` is 20, the `lessons` list must contain exactly 20 items).
*   **Section Duration Limit:** The `duration_minutes` for EACH section within EACH lesson MUST be an integer less than or equal to 5.
*   **Logical Structure:** Ensure the overall structure is coherent and follows the requested format.
</RetryContext>"""
            last_error_message = None

        final_instruction_input = "<FinalInstruction>Generate the CourseTimeStructure according to the System Prompt and time allocation guidelines provided below.</FinalInstruction>"
        # --- End Dynamic Snippets ---

        # --- Compose Generation Prompt (inside loop) ---
        generation_prompt_parts = [
            user_prompt_input,
            total_duration_input,
            DETAILED_TIME_GUIDANCE,
            retry_context_input,
            final_instruction_input
        ]
        generation_prompt = "\n".join(filter(None, generation_prompt_parts))
        # --- End Generation Prompt Composition ---

        try:
            time_structure = await llm.chat(generation_prompt, response_format=CourseTimeStructure)

            lesson_durations = [lesson.duration_minutes for lesson in time_structure.lessons]
            assert sum(lesson_durations) == total_duration_minutes, f"Validation failed: Sum of lesson durations ({sum(lesson_durations)}) does not match total ({total_duration_minutes})."
            assert len(time_structure.lessons) == time_structure.number_of_lessons, f"Validation failed: Number of lessons generated ({len(time_structure.lessons)}) does not match expected number ({time_structure.number_of_lessons})."

            for lesson in time_structure.lessons:
                for section in lesson.sections:
                    assert section.duration_minutes <= 5, f"Validation failed: Section {section.section_index} in lesson {lesson.lesson_index} exceeds 5 minutes ({section.duration_minutes})."
            return time_structure
        
        except Exception as e:
            last_error_message = str(e)
            logger.error(f"[{func_name}] Attempt {i+1} failed: {e}", exc_info=True)

            # if we are in last attempt and it failed, we generate a default time structure
            if i == retry - 1:
                return CourseTimeStructure.default(duration_minutes=total_duration_minutes)

    # Should not reach here
    logger.critical(f"[{func_name}] Reached end of function unexpectedly after {retry} retries.")
    raise Exception(f"Failed to generate time structure after {retry} retries")

async def genererate_course_plan(
    prompt: str,
    language: str,
    time_structure: CourseTimeStructure,
    relevant_content: list[str] = None,
) -> CoursePlan:
    """Generates a prompt and a title for each lesson in the course, will later be used to generate the lesson plan."""
    func_name = "genererate_course_plan"
    logger.info(f"[{func_name}] Starting generation. Language: {language}, Lessons: {time_structure.number_of_lessons}, Duration: {time_structure.duration_minutes} min.")
    logger.debug(f"[{func_name}] Prompt: '{prompt[:100]}...'")
    logger.debug(f"[{func_name}] Time Structure: {time_structure}")
    logger.debug(f"[{func_name}] Relevant Content Count: {len(relevant_content) if relevant_content else 0}")

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
As an expert Course Planner and Instructional Design LLM, your goal is to generate a strategic course plan based on the user's topic and instructions. This involves creating a course title and a set of detailed, actionable prompts for *individual lessons*. These lesson prompts will be given to a separate AI or human writer.
</RoleAndObjective>
"""

    # Simplified INSTRUCTIONS_CORE - only high-level steps
    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze User Input:** Carefully interpret the user's `prompt` for the course topic, objectives, and specific constraints provided in the user input section, including any `<RelevantContent>`.
        2.  **Structure the Plan:** Determine the overall `title_for_course`.
        3.  **Generate Lesson Prompts:** For the specified `number_of_lessons`, create a unique `title_for_lesson` and a detailed `prompt_for_lesson` for each, following the guidance provided in the user input section.
        4.  **Determine Presentation Style:** Select the most fitting `slide_preset` based on the course topic and implied style.
        5.  **Adhere to Format:** Ensure the final output strictly follows the required Pydantic/JSON structure (`CoursePlan`).
    </General>
    {language_instruction_placeholder}
    {citation_instruction_placeholder}
</Instructions>
"""

    # Detailed guidance block - kept separate
    LESSON_PROMPT_WRITING_GUIDANCE = """
<DetailedLessonPromptGuidance>
    <Instruction>Lesson prompts must be *instructions* for a writer.</Instruction>
    <Instruction>Each lesson prompt should detail objectives, key concepts, core principles, required depth, examples/cases (if relevant), and connections to other lessons or real-world applications.</Instruction>
    <Instruction>Focus prompts on *what content* to cover, not *how* to teach it.</Instruction>
    <Examples type="LessonPromptWriting">
        <Example type="negative"><Input>Lesson on criminal law basics...</Input><Explanation>Too vague, not an instruction.</Explanation></Example>
        <Example type="positive"><Output>Instruct the writer to create a comprehensive introduction to criminal law, starting with historical foundations and defining key terms like *actus reus* and *mens rea*.</Output></Example>
        <Example type="negative"><Input>Teach legal principles...</Input><Explanation>Focuses on 'how', not 'what'.</Explanation></Example>
        <Example type="positive"><Output>Instruct the writer to develop a detailed exploration of core legal principles, explaining the concept of precedent and analyzing the structure of the court system.</Output></Example>
        <Example type="negative"><Input>Include case studies...</Input><Explanation>Vague instruction.</Explanation></Example>
        <Example type="positive"><Output>Instruct the writer to incorporate analysis of landmark cases like [Specific Case Name] to illustrate the application of [Specific Principle].</Output></Example>
    </Examples>
</DetailedLessonPromptGuidance>
"""

    CONSTRAINTS = r"""
<Constraints>
    <Constraint name="NoInteractivity">
        - Absolutely no visual activities or illustrations.
        - Do not propose any questions, discussions, or open-ended or interactive activities.
    </Constraint>
    <Constraint name="ContentFocus">
        - Focus exclusively on textual substantive content.
        - Avoid discussing teaching methodology or pedagogical strategies.
        - Present information, examples, and analysis directly.
        - Do not reference classroom activities, discussions, or future lessons.
        - Concentrate on delivering core concepts and principles.
    </Constraint>
    <Constraint name="LaTeXWrapping">
        - All mathematical expressions, equations, symbols, variables, derivatives (e.g., $\frac{\partial f}{\partial y}$), and integrals (e.g., $\int_a^b f(x)\,dx$) MUST be enclosed in appropriate delimiters: `$ ... $` for inline math and `$$ ... $$` for block math.
        - Do NOT output raw LaTeX commands (e.g., `\quad`, `\frac`, `\alpha`, `\int`, `\partial`) or environments (e.g., `\begin{cases}...\end{cases}`) outside of these delimiters.
        - Ensure commands are spelled correctly (e.g., use `\frac`, not `\rac`).
        - Do not include non-standard characters (like control characters or form feeds `\f`) within or outside math delimiters.
        - Do NOT use `\[ ... \]` for math blocks.
        - Do NOT attach delimiters incorrectly (e.g., `y0,$$`). Use `$y0$` for inline or place the equation on its own line within `$$ ... $$`.
        <Example type="CorrectWrapping">
            <Good>`The formula is $\alpha \times \beta$.`</Good>
            <Good>`The error is $-\frac{h^2}{6}f^{(3)}(\xi) (=O(h^2))$.`</Good>
            <Good>`Set the initial condition $y(0)=y_0$.`</Good>
            <Good>`Verify the result $\int_0^\pi \sin x\,dx=2$.`</Good>
            <Good>`The Jacobian is $J(t,y)=\frac{\partial f}{\partial y}$.`</Good>
            <Good>
            ```markdown
            $$
            \begin{cases}
            x_1\' = x_2,\\\\
            x_2\' = x_3,\\\\
            \vdots \\\\
            x_{n-1}\' = x_n,\\\\
            x_n\' = f(t, x_1, \dots, x_n).
            \end{cases}
            $$
            ```
            </Good>
        </Example>
        <Example type="IncorrectWrapping">
            <Bad>`The formula is \alpha \times \beta.`</Bad>
            <Bad>`The error is -\frac{h^2}{6}f^{(3)}(\xi)\quad(=O(h^2)).` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>`Set the initial condition y(0)=y_0,$$` (Misplaced `$$`)</Bad>
            <Bad>`Verify the result \int_0^\pi \sin x\,dx=2.` (Missing `$ ... $`)</Bad>
            <Bad>`The Jacobian is J(t,y)=\f rac{\partial f}{\partial y}.` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>
            ```markdown
             \begin{cases} x_1\' = x_2 \\\\ x_2\' = f(t, x_1, x_2) \end{cases}
            ```
            (Missing `$$...$$` delimiters)
            </Bad>
        </Example>
    </Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the CoursePlan Pydantic model structure.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step: 1. Analyze user input. 2. Plan course structure and titles. 3. Generate detailed lesson prompts following guidance. 4. Select slide preset. 5. Format output.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Dynamic Snippets ---
    language_instruction = f"<TargetLanguageInstruction>Ensure all generated text (titles, prompts) is in {language.upper()}.</TargetLanguageInstruction>"
    user_topic_input = f"<UserTopic>{prompt}</UserTopic>"
    course_structure_input = f"<CourseStructureInput>Required Number of Lessons: {time_structure.number_of_lessons}</CourseStructureInput>"
    target_language_input = f"<TargetLanguage>Target Language: {language.upper()}</TargetLanguage>"
    final_instruction_input = f"<FinalInstruction>Generate the CoursePlan strictly according to the System Prompt and the detailed guidance provided below, ensuring all text is in {language.upper()}. Pay close attention to the citation requirement if relevant content is provided.</FinalInstruction>"

    relevant_content_input = ""
    citation_instruction = ""
    if relevant_content:
        # Format list into a readable block, without numbering
        formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
        relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Use heavily for citations, ordered by relevance):\n{formatted_relevant_content}\n</RelevantContent>"
        citation_instruction = """
        <CitationRequirement>
        **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
        - You MUST heavily cite the provided `<RelevantContent>` within the generated `prompt_for_lesson`.
        - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes.
        - Format citations like this:
          > "[Quote or paraphrased summary]"
        - Integrate these citations naturally and frequently throughout the lesson prompts to explicitly show reliance on the provided material.
        - Aim to include **multiple citations** in each lesson prompt where applicable.
        </CitationRequirement>
        """
    # --- End Dynamic Snippets ---

    # --- Compose System Prompt ---
    # Insert dynamic language and citation instructions into the INSTRUCTIONS_CORE block
    complete_instructions = INSTRUCTIONS_CORE.replace("{language_instruction_placeholder}", language_instruction)
    complete_instructions = complete_instructions.replace("{citation_instruction_placeholder}", citation_instruction)

    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        complete_instructions,  # Instructions at the top
        CONSTRAINTS,
        OUTPUT_FORMAT,
        # --- Repeat Core Instructions for Emphasis/Long Context --- #
        complete_instructions,
        THINKING_PROCESS,      # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    # --- Compose Generation Prompt ---
    generation_prompt_parts = [
        user_topic_input,
        course_structure_input,
        target_language_input,
        relevant_content_input,         # This is an empty string if no relevant content
        LESSON_PROMPT_WRITING_GUIDANCE, # Detailed guidance included here
        final_instruction_input
    ]
    # Filter out empty strings (like relevant_content_input if it was empty)
    generation_prompt = "\n".join(filter(None, generation_prompt_parts))
    # --- End Generation Prompt Composition ---

    @dynamic_model
    class CoursePlan(BaseModel):
        title_for_course: str = Field(description="The title of the course")
        title_for_lesson: list[str] = Field(
            count=time_structure.number_of_lessons,
            description="The title for the lesson", # Simplified description as per user feedback likely desired
        )
        prompt_for_lesson: list[str] = Field(
            count=time_structure.number_of_lessons,
            description="Rich, detailed instructional prompt for generating an individual lesson plan, following provided guidance", # Simplified description
        )
        slide_preset: str = Field(
            description="Preset for slides. Choose one from the following options: [professional, creative, minimalist, earthy, tech, vibrant, serene, futuristic, organic, luxury]. This should reflect the overall course style."
        )

    try:
        logger.info(f"[{func_name}] Calling LLM ({FAST_MODEL}) for course plan.")
        planner = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)
        course_plan: CoursePlan = await planner.chat(
            generation_prompt,
            response_format=CoursePlan,
            temperature=0.4
        )
        logger.info(f"[{func_name}] LLM call successful. Generated plan for {len(course_plan.title_for_lesson)} lessons. Preset: {course_plan.slide_preset}.")
        logger.debug(f"[{func_name}] Generated Course Title: {course_plan.title_for_course}")
        return course_plan
    except Exception as e:
        logger.error(f"[{func_name}] LLM call failed: {e}", exc_info=True)
        raise # Re-raise the exception after logging

async def generate_structured_lesson_plan(
    prompt: str,
    language: str,
    lesson_time_structure: LessonTimeStructure,
    relevant_content: list[str] = None,
) -> StructuredLessonPlan:
    func_name = "generate_structured_lesson_plan"
    logger.info(f"[{func_name}] Starting generation. Language: {language}, Sections: {lesson_time_structure.number_of_sections}, Duration: {lesson_time_structure.duration_minutes} min.")
    logger.debug(f"[{func_name}] Prompt: '{prompt[:100]}...'")
    logger.debug(f"[{func_name}] Time Structure: {lesson_time_structure}")
    logger.debug(f"[{func_name}] Relevant Content Count: {len(relevant_content) if relevant_content else 0}")

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are a highly specialized Lesson Planner LLM with expertise in educational content creation.
Your goal is to create a detailed, structured lesson plan based on the user's prompt and time requirements.
The plan will specify a general approach and then detail each section (description, duration, style, instructions).
</RoleAndObjective>
"""

    # Simplified INSTRUCTIONS_CORE - only high-level steps
    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze User Input:** Understand the lesson's topic and objectives from the user prompt and context.
        2.  **Overall Plan:** Create a `general_plan` outlining the lesson's goals and flow.
        3.  **Divide into Sections:** Structure the lesson into the specified `number_of_sections`.
        4.  **Plan Each Section:** For each section, define its `short_description`, `duration_minutes`, `style`, and detailed `instructions` based on the guidance provided in the user input.
        5.  **Adhere to Format:** Ensure the final output strictly follows the required `StructuredLessonPlan` Pydantic/JSON structure.
    </General>
    {language_instruction_placeholder} 
</Instructions>
"""

    # Detailed guidance block - kept separate
    DETAILED_PLANNING_GUIDANCE = """
<DetailedPlanningGuidance>
    <Instruction>Focus on creating instructions for a *lesson writer* AI or human.</Instruction>
    <Instruction>The 'instructions' field for each section is critical - be detailed about topics, depth, style, tone, and specific content requirements.</Instruction>
    <Instruction>Emphasize the need for transitions connecting sections.</Instruction>
    <Instruction>Guide the writer to use extensive markdown formatting in the final lesson content:</Instruction>
    <Formatting type="MarkdownForWriter">
        - Headings (`#`, `##`, `###`)
        - Text formatting: **bold**, *italics*, ~~strikethrough~~
        - Lists (ordered, unordered, nested)
        - Blockquotes (`>`)
        - Tables
        - Code blocks (```language ... ```)
        - LaTeX (`$...$` inline, `$$...$$` block)
    </Formatting>
    <Examples type="InstructionWriting">
        <Example type="negative">
            <Input>The lesson will cover the basics of criminal procedure...</Input>
            <Explanation>Not an instruction for a writer.</Explanation>
        </Example>
        <Example type="positive">
            <Output>Instruct the writer to create a detailed exploration of criminal procedure, beginning with arrest protocols...</Output>
        </Example>
        <Example type="negative">
            <Input>Students should understand the importance of evidence...</Input>
            <Explanation>Focuses on student outcomes, not writer instructions.</Explanation>
        </Example>
        <Example type="positive">
            <Output>Instruct the writer to develop a thorough analysis of evidence law, starting with the chain of custody concept...</Output>
        </Example>
         <Example type="negative">
            <Input>This section covers teaching strategies...</Input>
            <Explanation>Focuses on pedagogy, not content for the writer.</Explanation>
        </Example>
        <Example type="positive">
            <Output>Instruct the writer to examine the fundamental principles of [Topic] and their applications using detailed examples...</Output>
        </Example>
    </Examples>
</DetailedPlanningGuidance>
"""

    CONSTRAINTS = r"""
<Constraints>
    <Constraint name="ContentFocus">
        - Focus on actual content topics, not explanations (the writer will handle explanations).
        - Focus on style instructions and topic inclusion for depth.
        - Do not hold back on technical depth or complexity; assume a university-level audience.
        - Mention all relevant topics explicitly, as the writer will only include what is mentioned.
        - Concentrate on substantive material and core principles, not teaching methodology.
    </Constraint>
    <Constraint name="LaTeXWrapping">
        - All mathematical expressions, equations, symbols, variables, derivatives (e.g., $\frac{\partial f}{\partial y}$), and integrals (e.g., $\int_a^b f(x)\,dx$) MUST be enclosed in appropriate delimiters: `$ ... $` for inline math and `$$ ... $$` for block math.
        - Do NOT output raw LaTeX commands (e.g., `\quad`, `\frac`, `\alpha`, `\int`, `\partial`) or environments (e.g., `\begin{cases}...\end{cases}`) outside of these delimiters.
        - Ensure commands are spelled correctly (e.g., use `\frac`, not `\rac`).
        - Do not include non-standard characters (like control characters or form feeds `\f`) within or outside math delimiters.
        - Do NOT use `\[ ... \]` for math blocks.
        - Do NOT attach delimiters incorrectly (e.g., `y0,$$`). Use `$y0$` for inline or place the equation on its own line within `$$ ... $$`.
        <Example type="CorrectWrapping">
            <Good>`The formula is $\alpha \times \beta$.`</Good>
            <Good>`The error is $-\frac{h^2}{6}f^{(3)}(\xi) (=O(h^2))$.`</Good>
            <Good>`Set the initial condition $y(0)=y_0$.`</Good>
            <Good>`Verify the result $\int_0^\pi \sin x\,dx=2$.`</Good>
            <Good>`The Jacobian is $J(t,y)=\frac{\partial f}{\partial y}$.`</Good>
            <Good>
            ```markdown
            $$
            \begin{cases}
            x_1\' = x_2,\\\\
            x_2\' = x_3,\\\\
            \vdots \\\\
            x_{n-1}\' = x_n,\\\\
            x_n\' = f(t, x_1, \dots, x_n).
            \end{cases}
            $$
            ```
            </Good>
        </Example>
        <Example type="IncorrectWrapping">
            <Bad>`The formula is \alpha \times \beta.`</Bad>
            <Bad>`The error is -\frac{h^2}{6}f^{(3)}(\xi)\quad(=O(h^2)).` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>`Set the initial condition y(0)=y_0,$$` (Misplaced `$$`)</Bad>
            <Bad>`Verify the result \int_0^\pi \sin x\,dx=2.` (Missing `$ ... $`)</Bad>
            <Bad>`The Jacobian is J(t,y)=\f rac{\partial f}{\partial y}.` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>
            ```markdown
             \begin{cases} x_1\' = x_2 \\\\ x_2\' = f(t, x_1, x_2) \end{cases}
            ```
            (Missing `$$...$$` delimiters)
            </Bad>
        </Example>
    </Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the StructuredLessonPlan Pydantic model structure, including a `general_plan` string and a list of `sections`, where each section adheres to the `SectionInformation` model.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step: 1. Analyze prompt & structure. 2. Draft general plan. 3. Detail instructions for each section following guidance. 4. Ensure adherence to time constraints and output format.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Dynamic Snippets ---
    language_instruction = f"<TargetLanguageInstruction>Ensure all generated text (plans, instructions, etc.) is in {language.upper()}.</TargetLanguageInstruction>"
    user_prompt_input = f"<UserPrompt>{prompt}</UserPrompt>"
    lesson_structure_input = f"<LessonStructureInput>Create exactly {lesson_time_structure.number_of_sections} sections. Adhere to this time distribution: {lesson_time_structure}</LessonStructureInput>"
    target_language_input = f"<TargetLanguage>Target Language: {language.upper()}</TargetLanguage>"
    final_instruction_input = f"<FinalInstruction>Generate the StructuredLessonPlan strictly according to the System Prompt and the detailed guidance provided below, ensuring all text is in {language.upper()}. Pay close attention to the required number of sections and time allocations.</FinalInstruction>"
    relevant_content_input = ""
    citation_instruction = ""
    if relevant_content:
        formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
        relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Use heavily for citations, ordered by relevance):\n{formatted_relevant_content}\n</RelevantContent>"
        citation_instruction = """
        <CitationRequirement>
        **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
        - You MUST heavily cite the provided `<RelevantContent>` within the generated `instructions`.
        - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes.
        - Format citations like this:
          > "[Quote or paraphrased summary]"
        - Integrate these citations naturally and frequently throughout the section instructions to explicitly show reliance on the provided material.
        - Aim to include **multiple citations** in each section's instructions where applicable.
        </CitationRequirement>
        """
    # --- End Dynamic Snippets ---

    # --- Compose System Prompt ---
    complete_instructions = INSTRUCTIONS_CORE.replace("{language_instruction_placeholder}", language_instruction)
    complete_instructions = complete_instructions.replace("{citation_instruction_placeholder}", citation_instruction)

    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        complete_instructions,  # Instructions at the top
        CONSTRAINTS,
        OUTPUT_FORMAT,
        complete_instructions,  # Instructions repeated at the end
        THINKING_PROCESS,      # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    # --- Compose Generation Prompt ---
    generation_prompt_parts = [
        user_prompt_input,
        lesson_structure_input,
        target_language_input,
        relevant_content_input,
        DETAILED_PLANNING_GUIDANCE, # Detailed how-to guidance included here
        final_instruction_input
    ]
    generation_prompt = "\n".join(filter(None, generation_prompt_parts))
    # --- End Generation Prompt Composition ---

    # Pydantic models remain defined locally as they are standard
    class SectionInformation(BaseModel):
        short_description: str = Field(
            description="A single sentence that describes what this section is about"
        )
        duration_minutes: int = Field(
            description="Specifies the duration of the section in minutes"
        )
        style: str = Field(
            description="Style guidelines for writing the section based on lesson requirements"
        )
        instructions: str = Field(
            description="Detailed instructions for the AI to create the section content, this is the most important field, add everything you want to transmit to the writer. Add topics, style, tone, information it needs to include, advice on what to write, etc. This field should be long, very long."
        )

    class StructuredLessonPlan(BaseModel):
        general_plan: str = Field(description="A general plan for the lesson, think of the things you want to achieve with the lesson, think of the things we want to write, etc, and write it here.")
        sections: list[SectionInformation] = Field(
            description="Planning for each section to be created"
        )

    try:
        logger.info(f"[{func_name}] Calling LLM ({FAST_MODEL}) for structured lesson plan.")
        planner = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)
        plan: StructuredLessonPlan = await planner.chat(generation_prompt, response_format=StructuredLessonPlan)
        logger.info(f"[{func_name}] LLM call successful. Generated plan with {len(plan.sections)} sections.")
        logger.debug(f"[{func_name}] Generated General Plan: {plan.general_plan[:100]}...")
        return plan
    except Exception as e:
        logger.error(f"[{func_name}] LLM call failed: {e}", exc_info=True)
        raise

async def generate_lesson_plan(
    prompt: str,
    language: str,
    lesson_time_structure: LessonTimeStructure,
    relevant_content: list[str] = None,
) -> LessonPlan:
    func_name = "generate_lesson_plan"
    logger.info(f"[{func_name}] Starting generation (unstructured strings). Language: {language}, Sections: {lesson_time_structure.number_of_sections}, Duration: {lesson_time_structure.duration_minutes} min.")
    logger.debug(f"[{func_name}] Prompt: '{prompt[:100]}...'")
    logger.debug(f"[{func_name}] Time Structure: {lesson_time_structure}")
    logger.debug(f"[{func_name}] Relevant Content Count: {len(relevant_content) if relevant_content else 0}")

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are a highly specialized Lesson Planner LLM with expertise in educational content creation.
Your goal is to create a detailed lesson plan, outputting **one descriptive string per section**, based on the user's prompt and time requirements. Each string should encapsulate all necessary planning details for that section.
</RoleAndObjective>
"""

    # Simplified INSTRUCTIONS_CORE - only high-level steps
    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze User Input:** Understand the lesson's topic and objectives from the user prompt and context.
        2.  **Divide into Sections:** Plan for the specified `number_of_sections`.
        3.  **Generate Section Strings:** For each section, generate a single, comprehensive descriptive string incorporating content instructions, style, duration, and transitions, based on the detailed guidance provided in the user input.
        4.  **Adhere to Format:** Ensure the final output is a list containing exactly one string per required section, fitting the `LessonPlan` Pydantic model.
    </General>
    {language_instruction_placeholder} 
</Instructions>
"""

    # Detailed guidance block - same as function #2, informs string content
    DETAILED_PLANNING_GUIDANCE = """
<DetailedPlanningGuidance>
    <Instruction>Focus on creating instructions for a *lesson writer* AI or human within each section string.</Instruction>
    <Instruction>The section string must be detailed about topics, depth, style, tone, and specific content requirements.</Instruction>
    <Instruction>Emphasize the need for transitions connecting sections within the description.</Instruction>
    <Instruction>Guide the *next step writer* (implicitly, by structuring the string content) to use extensive markdown formatting in the final lesson content:</Instruction>
    <Formatting type="MarkdownForWriter">
        - Headings (`#`, `##`, `###`)
        - Text formatting: **bold**, *italics*, ~~strikethrough~~
        - Lists (ordered, unordered, nested)
        - Blockquotes (`>`)
        - Tables
        - Code blocks (```language ... ```)
        - LaTeX (`$...$` inline, `$$...$$` block)
    </Formatting>
    <Examples type="InstructionWritingStyle">
        <Example type="negative">
            <Input>The lesson will cover the basics of criminal procedure...</Input>
            <Explanation>Too brief for a section plan string.</Explanation>
        </Example>
        <Example type="positive">
            <Output>Section 1 (10 mins): Create a detailed exploration of criminal procedure, beginning with arrest protocols... [include style, topics, transitions etc.]</Output>
            <Explanation>Comprehensive string capturing all elements.</Explanation>
        </Example>
         <Example type="negative">
            <Input>This section covers teaching strategies...</Input>
            <Explanation>Focuses on pedagogy, not content for the writer.</Explanation>
        </Example>
        <Example type="positive">
            <Output>Section 2 (15 mins): Instruct the writer to examine the fundamental principles of [Topic] and their applications using detailed examples... [include style, topics, transitions etc.]</Output>
            <Explanation>Clear instruction within the section string.</Explanation>
        </Example>
    </Examples>
</DetailedPlanningGuidance>
"""

    # Constraints - same as function #2
    CONSTRAINTS = r"""
<Constraints>
    <Constraint name="ContentFocus">
        - Focus on actual content topics, not explanations (the writer will handle explanations).
        - Focus on style instructions and topic inclusion for depth.
        - Do not hold back on technical depth or complexity; assume a university-level audience.
        - Mention all relevant topics explicitly, as the writer will only include what is mentioned.
        - Concentrate on substantive material and core principles, not teaching methodology.
    </Constraint>
    <Constraint name="LaTeXWrapping">
        - All mathematical expressions, equations, symbols, variables, derivatives (e.g., $\frac{\partial f}{\partial y}$), and integrals (e.g., $\int_a^b f(x)\,dx$) MUST be enclosed in appropriate delimiters: `$ ... $` for inline math and `$$ ... $$` for block math.
        - Do NOT output raw LaTeX commands (e.g., `\quad`, `\frac`, `\alpha`, `\int`, `\partial`) or environments (e.g., `\begin{cases}...\end{cases}`) outside of these delimiters.
        - Ensure commands are spelled correctly (e.g., use `\frac`, not `\rac`).
        - Do not include non-standard characters (like control characters or form feeds `\f`) within or outside math delimiters.
        - Do NOT use `\[ ... \]` for math blocks.
        - Do NOT attach delimiters incorrectly (e.g., `y0,$$`). Use `$y0$` for inline or place the equation on its own line within `$$ ... $$`.
        <Example type="CorrectWrapping">
            <Good>`The formula is $\alpha \times \beta$.`</Good>
            <Good>`The error is $-\frac{h^2}{6}f^{(3)}(\xi) (=O(h^2))$.`</Good>
            <Good>`Set the initial condition $y(0)=y_0$.`</Good>
            <Good>`Verify the result $\int_0^\pi \sin x\,dx=2$.`</Good>
            <Good>`The Jacobian is $J(t,y)=\frac{\partial f}{\partial y}$.`</Good>
            <Good>`This is true $\quad\text{where}\quad e^{At} = \sum_{k=0}^\infty \frac{(At)^k}{k!}$.`</Good>
            <Good>`Maxwell's equation: $\nabla \times \boldsymbol{E} = -\frac{\partial \boldsymbol{B}}{\partial t}$`</Good>
            <Good>
            ```markdown
            $$
            \mathbf{x}(t) = e^{At}\,\mathbf{x}_0 + \int_{0}^{t} e^{A(t-s)}\,\mathbf{f}(s)\,ds.
            $$
            ```
            </Good>
            <Good>
            ```markdown
            $$
            \begin{cases}
            x_1\' = x_2,\\\\
            x_2\' = x_3,\\\\
            \vdots \\\\
            x_{n-1}\' = x_n,\\\\
            x_n\' = f(t, x_1, \dots, x_n).
            \end{cases}
            $$
            ```
            </Good>
        </Example>
        <Example type="IncorrectWrapping">
            <Bad>`The formula is \alpha \times \beta.`</Bad>
            <Bad>`The error is -\frac{h^2}{6}f^{(3)}(\xi)\quad(=O(h^2)).` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>`Set the initial condition y(0)=y_0,$$` (Misplaced `$$`)</Bad>
            <Bad>`Verify the result \int_0^\pi \sin x\,dx=2.` (Missing `$ ... $`)</Bad>
            <Bad>`The Jacobian is J(t,y)=\f rac{\partial f}{\partial y}.` (Contains `\f` and typo `\rac`)</Bad>
            <Bad>`\quad\text{where}\quad e^{At} = \sum_{k=0}^\infty \frac{(At)^k}{k!}.$$` (Commands `\quad`, `\text` outside delimiters)</Bad>
            <Bad>`$\nabla\t\times \boldsymbol{E}$` (Contains TAB `\t` instead of space)</Bad>
            <Bad>
            ```markdown
             \mathbf{x}(t) = e^{At}\,\mathbf{x}_0 + \int_{0}^{t} e^{A(t-s)}\,\mathbf{f}(s)\,ds.
            ```
            (Missing `$$...$$` delimiters)
            </Bad>
            <Bad>
            ```markdown
             \begin{cases} x_1\' = x_2 \\\\ x_2\' = f(t, x_1, x_2) \end{cases}
            ```
            (Missing `$$...$$` delimiters)
            </Bad>
        </Example>
    </Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the LessonPlan Pydantic model structure: a list containing exactly one string per required section.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step: 1. Analyze prompt & structure. 2. For each section, formulate a single, detailed descriptive string incorporating all planning elements and guidance. 3. Format output as a list of these strings.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Dynamic Snippets ---
    language_instruction = f"<TargetLanguageInstruction>Ensure all generated text is in {language.upper()}.</TargetLanguageInstruction>"
    user_prompt_input = f"<UserPrompt>{prompt}</UserPrompt>"
    lesson_structure_input = f"<LessonStructureInput>Create exactly {lesson_time_structure.number_of_sections} section plan strings. Adhere to this time distribution: {lesson_time_structure}</LessonStructureInput>"
    target_language_input = f"<TargetLanguage>Target Language: {language.upper()}</TargetLanguage>"
    final_instruction_input = f"<FinalInstruction>Generate the LessonPlan (list of section plan strings) strictly according to the System Prompt and the detailed guidance provided below, ensuring all text is in {language.upper()}.</FinalInstruction>"
    relevant_content_input = ""
    citation_instruction = ""
    if relevant_content:
        formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
        relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Use heavily for citations, ordered by relevance):\n{formatted_relevant_content}\n</RelevantContent>"
        citation_instruction = """
        <CitationRequirement>
        **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
        - You MUST heavily cite the provided `<RelevantContent>` within the generated `section_plan` strings.
        - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes within the descriptive string for that section.
        - Format citations like this:
          > "[Quote or paraphrased summary]"
        - Integrate these citations naturally and frequently throughout the section plan strings to explicitly show reliance on the provided material.
        - Aim to include **multiple citations** in each section string where applicable.
        </CitationRequirement>
        """
    # --- End Dynamic Snippets ---

    # --- Compose System Prompt ---
    complete_instructions = INSTRUCTIONS_CORE.replace("{language_instruction_placeholder}", language_instruction)
    complete_instructions = complete_instructions.replace("{citation_instruction_placeholder}", citation_instruction)

    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        complete_instructions,  # Instructions at the top
        CONSTRAINTS,
        OUTPUT_FORMAT,
        complete_instructions,  # Instructions repeated at the end
        THINKING_PROCESS,      # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    # --- Compose Generation Prompt ---
    generation_prompt_parts = [
        user_prompt_input,
        lesson_structure_input,
        target_language_input,
        relevant_content_input,
        DETAILED_PLANNING_GUIDANCE, # Detailed how-to guidance included here
        final_instruction_input
    ]
    generation_prompt = "\n".join(filter(None, generation_prompt_parts))
    # --- End Generation Prompt Composition ---

    @dynamic_model
    class LessonPlan(BaseModel):
        section_plan: list[str] = Field(
            count=lesson_time_structure.number_of_sections, description="Content for section plan"
        )

    try:
        logger.info(f"[{func_name}] Calling LLM ({FAST_MODEL}) for lesson plan strings.")
        planner = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)
        plan: LessonPlan = await planner.chat(generation_prompt, response_format=LessonPlan)
        logger.info(f"[{func_name}] LLM call successful. Generated {len(plan.section_plan)} section plan strings.")
        return plan
    except Exception as e:
        logger.error(f"[{func_name}] LLM call failed: {e}", exc_info=True)
        raise

async def structure_plan(plan: LessonPlan) -> StructuredLessonPlan:
    func_name = "structure_plan"
    logger.info(f"[{func_name}] Starting structuring of {len(plan.section_plan)} plan strings.")

    # --- Static Prompt Component Blocks (defined once) ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an AI content analyst specialized in structuring educational content.
Your task is to parse a descriptive text block for a lesson section and extract key fields into a structured format.
</RoleAndObjective>
"""

    # Simplified INSTRUCTIONS_CORE - only high-level steps
    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze Input:** Carefully read the input text provided in `<InputSectionContent>`.
        2.  **Extract Fields:** Identify and extract the `short_description`, `duration_minutes`, `style` guidelines, and the main `instructions` content based on the detailed extraction guidance provided.
        3.  **Adhere to Format:** Ensure the final output strictly follows the `SectionInformation` Pydantic model.
    </General>
</Instructions>
"""

    # Detailed guidance block - moved to generation prompt
    DETAILED_EXTRACTION_GUIDANCE = """
<DetailedExtractionGuidance>
    <Guideline>Look for introductory sentences summarizing the section for `short_description`.</Guideline>
    <Guideline>Search for numerical values associated with time units (e.g., 'minutes', 'min') for `duration_minutes`.</Guideline>
    <Guideline>Identify phrases describing the tone, format, or approach for `style`.</Guideline>
    <Guideline>Treat the core content description, topic lists, writer instructions, and transition notes as the `instructions` field. Be comprehensive and capture all relevant details intended for the lesson writer.</Guideline>
</DetailedExtractionGuidance>
"""

    CONSTRAINTS = """
<Constraints>
    <Constraint name="Accuracy">Extract information accurately based *only* on the provided input text.</Constraint>
    <Constraint name="Comprehensiveness">The `instructions` field should capture the bulk of the planning details intended for the lesson writer.</Constraint>
    <Constraint name="Interpretation">Interpret variations in phrasing (e.g., "Duration: X min", "X minutes long") for the duration.</Constraint>
    <Constraint name="Focus">Focus on extracting content details, not adding interpretation or new information.</Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the SectionInformation Pydantic model structure.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step: 1. Read input text. 2. Identify short description. 3. Identify duration. 4. Identify style. 5. Consolidate main instructions. 6. Format output as SectionInformation.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Compose System Prompt (once before loop) ---
    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        INSTRUCTIONS_CORE,  # Instructions at the top
        CONSTRAINTS,
        OUTPUT_FORMAT,
        INSTRUCTIONS_CORE,  # Instructions repeated at the end
        THINKING_PROCESS,   # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    sections: list[SectionInformation] = []
    tasks = []
    logger.info(f"[{func_name}] Creating {len(plan.section_plan)} parallel structuring tasks.")
    llm = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client) # Create LLM instance once

    for i, section_str in enumerate(plan.section_plan):
        # --- Dynamic Snippets (inside loop) ---
        input_section_content = f"<InputSectionContent>\n{section_str}\n</InputSectionContent>"
        final_instruction_input = "<FinalInstruction>Parse the provided InputSectionContent and generate the SectionInformation object according to the System Prompt and detailed extraction guidance.</FinalInstruction>"
        # --- End Dynamic Snippets ---

        # --- Compose Generation Prompt (inside loop) ---
        generation_prompt_parts = [
            input_section_content,
            DETAILED_EXTRACTION_GUIDANCE,
            final_instruction_input
        ]
        generation_prompt = "\n".join(filter(None, generation_prompt_parts))
        # --- End Generation Prompt Composition ---

        # Add the task using the shared LLM instance
        logger.debug(f"[{func_name}] Adding task for section {i+1}/{len(plan.section_plan)}")
        tasks.append(llm.chat(generation_prompt, response_format=SectionInformation))

    try:
        logger.info(f"[{func_name}] Gathering results from {len(tasks)} structuring tasks.")
        results = await asyncio.gather(*tasks)
        sections.extend(results)
        logger.info(f"[{func_name}] Successfully structured {len(sections)} sections.")
        lesson_planning = StructuredLessonPlan(general_plan="Generated from structured plan", sections=sections)
        return lesson_planning
    except Exception as e:
        logger.error(f"[{func_name}] Failed to gather structuring results: {e}", exc_info=True)
        raise

async def get_lesson_plan_with_retry(
    prompt: str,
    language: str,
    lesson_time_structure: LessonTimeStructure,
    relevant_content: list[str] = None,
    retry: int = 2,
) -> StructuredLessonPlan:
    func_name = "get_lesson_plan_with_retry"
    logger.info(f"[{func_name}] Attempting lesson plan generation. Max retries: {retry}.")

    # first we try with generate_structured_lesson_plan directly
    logger.info(f"[{func_name}] Attempting direct structured generation.")
    for i in range(retry):
        try:
            structured_lesson_plan = await generate_structured_lesson_plan(prompt, language, lesson_time_structure, relevant_content)
            logger.info(f"[{func_name}] Direct generation attempt {i+1} successful. Validating...")
            # Validation
            if len(structured_lesson_plan.sections) != lesson_time_structure.number_of_sections:
                raise ValueError(f"Generated lesson plan has {len(structured_lesson_plan.sections)} sections, expected {lesson_time_structure.number_of_sections}")
            total_gen_duration = sum(section.duration_minutes for section in structured_lesson_plan.sections)
            if total_gen_duration != lesson_time_structure.duration_minutes:
                raise ValueError(f"Generated lesson plan has a total duration of {total_gen_duration} minutes, expected {lesson_time_structure.duration_minutes}")
            logger.info(f"[{func_name}] Validation successful. Returning structured plan.")
            return structured_lesson_plan
        except Exception as e:
            logger.warning(f"[{func_name}] Direct structured generation failed (Attempt {i+1}/{retry}): {e}")
            if i == retry - 1:
                 logger.warning(f"[{func_name}] Direct generation failed after {retry} attempts. Falling back to unstructured + structuring.")

    # if we fail, we try with generate_lesson_plan + structure_plan
    logger.info(f"[{func_name}] Falling back to unstructured generation followed by structuring.")
    for i in range(retry):
        try:
            logger.info(f"[{func_name}] Attempting unstructured generation (Attempt {i+1}/{retry}).")
            lesson_plan = await generate_lesson_plan(prompt, language, lesson_time_structure, relevant_content)
            logger.info(f"[{func_name}] Unstructured generation attempt {i+1} successful. Structuring plan...")
            structured_lesson_plan = await structure_plan(lesson_plan)
            logger.info(f"[{func_name}] Structuring successful. Returning structured plan.")
            return structured_lesson_plan
        except Exception as e:
            logger.warning(f"[{func_name}] Unstructured generation + structuring failed (Attempt {i+1}/{retry}): {e}")

    logger.error(f"[{func_name}] Failed to generate lesson plan after all retry attempts.")
    raise Exception(f"Failed to generate lesson plan after {retry * 2} total attempts")

async def write_lesson(
    lesson_planning: StructuredLessonPlan,
    language: str,
    relevant_content: list[str] = None,
) -> LessonGeneration:
    func_name = "write_lesson"

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an expert professor writing the actual lesson content that students will read directly.
This is not a plan or guide; it's the final educational material to be presented.
</RoleAndObjective>
"""

    # Simplified INSTRUCTIONS_CORE - only high-level steps
    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze Input Plan:** Understand the structure and section-specific instructions in `<LessonPlanInput>`.
        2.  **Generate Titles & Content:** For each section plan provided:
            a. Create a concise `title_for_section`.
            b. Write the substantive `content_for_section`, strictly adhering to the `instructions`, `style`, and scope defined for that section in the input plan.
            c. Apply rich formatting as guided in the user input section.
        3.  **Match Section Count:** Ensure the number of generated titles and content blocks exactly matches the number of sections in the input plan.
        4.  **Adhere to Format:** Ensure the final output strictly follows the `LessonGeneration` Pydantic model.
    </General>
    {language_instruction_placeholder} 
</Instructions>
"""

    # Detailed guidance block - moved to generation prompt
    DETAILED_WRITING_GUIDANCE = """
<DetailedWritingGuidance>
    <Guideline>Write directly to the student in an engaging, clear, yet academic professor tone.</Guideline>
    <Guideline>Use rich markdown formatting extensively to structure content and enhance readability:</Guideline>
    <Formatting type="Markdown">
        - Headings (`#`, `##`, `###`) for organization.
        - Text emphasis: **bold**, *italics*, ~~strikethrough~~.
        - Lists: ordered (1.), unordered (*, -), nested.
        - Blockquotes (`>`).
        - Tables (Markdown syntax).
        - Code blocks (```language ... ```).
    </Formatting>
    <Formatting type="LaTeX">
        See <LaTeXGuidelines>, <LaTeXWhitelist>, and <LaTeXWhitelistExamples>
        for the exact rules & allowed macros.
    </Formatting>
    <Guideline>Maintain clear transitions between ideas within each section.</Guideline>
    <Guideline>Be thorough and expand deeply on the topics specified for each section. Do not hold back on technical details.</Guideline>
</DetailedWritingGuidance>
"""

    CONSTRAINTS = r"""
<Constraints>
    <Constraint name="OutputFocus">Produce *actual lesson content*, not planning notes or meta-commentary.</Constraint>
    <Constraint name="Faithfulness">Strictly follow the specific `instructions` and `style` provided for *each section* in the `<LessonPlanInput>`. Do not add unrequested topics or deviate from the scope defined for each section.</Constraint>
    <Constraint name="ContentOnly">Avoid discussing pedagogy, classroom activities, interactive elements, or questions.</Constraint>
    <Constraint name="Depth">Maintain depth and technical rigor appropriate for a university level.</Constraint>
    <Constraint name="WhitelistOnly">
        Use **only** macros/envs in <LaTeXWhitelist>; <LaTeXBlacklist> items are forbidden.
    </Constraint>
    <Constraint name="NoIndentBlockMath">
        **Never produce `$$ … $$` in a line that belongs to**
        • list items (`-`, `*`, `+`, `1.`) • nested lists • block quotes `>` • tables • code fences.
        Inside those, always switch to inline `$ … $`.
        If you want a block equation, end the structure, add a blank line, write the
        flush-left block math, add another blank line, then continue.
    </Constraint>
    <Constraint name="NoInlineDoubleDollar">
        Double-dollar math is forbidden inline; convert to single-dollar.
        Never place `$$ … $$` inside a paragraph, list, table, or quote.
        `$$` is reserved for standalone block math only.
    </Constraint>
    <Constraint name="DelimiterBalance">
        Even count of `$` and even count of `$$` in final output.
    </Constraint>
    <Constraint name="NoHorizontalRules">
        Avoid markdown horizontal rules: never output lines consisting solely of 3 or more hyphens (`---`), asterisks (`***`), or underscores (`___`). Such separators break downstream PDF rendering.
    </Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the LessonGeneration Pydantic model structure, providing lists for `title_for_section` and `content_for_section` with a count matching the input plan's sections.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step: 1. Read and understand the overall lesson plan structure and goals. 2. Process each section plan sequentially. 3. For each section: Generate a title, carefully write the content following *its specific instructions* and style, applying detailed formatting guidance. 4. Consolidate all titles and content blocks into the final LessonGeneration structure.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Dynamic Snippets ---
    language_instruction = f"<TargetLanguageInstruction>Ensure all generated text (titles, content) is in {language.upper()}.</TargetLanguageInstruction>"
    # Serialize the input lesson plan
    serialized_lesson_planning = lesson_planning.model_dump_json(indent=2)
    lesson_plan_input = f"<LessonPlanInput>\n{serialized_lesson_planning}\n</LessonPlanInput>"
    target_language_input = f"<TargetLanguage>Target Language: {language.upper()}</TargetLanguage>"
    final_instruction_input = f"<FinalInstruction>Generate the LessonGeneration content strictly according to the System Prompt and the detailed writing guidance provided below, ensuring all text is in {language.upper()}. Faithfully implement the section-specific instructions provided in the LessonPlanInput.</FinalInstruction>"
    relevant_content_input = ""
    citation_instruction = ""
    if relevant_content:
        formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
        relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Use heavily for citations, ordered by relevance):\n{formatted_relevant_content}\n</RelevantContent>"
        citation_instruction = """
        <CitationRequirement>
        **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
        - You MUST heavily cite the provided `<RelevantContent>` within the generated `content_for_section`.
        - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes.
        - Format citations like this:
          > "[Quote or paraphrased summary]"
        - Integrate these citations naturally and frequently throughout the lesson content to explicitly show reliance on the provided material.
        - Aim to include **multiple citations** in each section's content where applicable.
        </CitationRequirement>
        """
    # --- End Dynamic Snippets ---

    # --- Compose System Prompt ---
    complete_instructions = INSTRUCTIONS_CORE.replace("{language_instruction_placeholder}", language_instruction)
    complete_instructions = complete_instructions.replace("{citation_instruction_placeholder}", citation_instruction)

    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        complete_instructions,  # Instructions at the top
        CONSTRAINTS,
        OUTPUT_FORMAT,
        complete_instructions,  # Instructions repeated at the end
        THINKING_PROCESS,      # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    # --- Compose Generation Prompt ---
    generation_prompt_parts = [
        lesson_plan_input,          # Contains the structured plan
        target_language_input,
        relevant_content_input,
        DETAILED_WRITING_GUIDANCE,  # How to write the content
        final_instruction_input
    ]
    generation_prompt = "\n".join(filter(None, generation_prompt_parts))
    # --- End Generation Prompt Composition ---

    @dynamic_model
    class LessonGeneration(BaseModel):
        title_for_section: list[str] = Field(
            count=len(lesson_planning.sections), description="The title for the section"
        )
        content_for_section: list[str] = Field(
            count=len(lesson_planning.sections), description="Content for section"
        )

    try:
        logger.info(f"[{func_name}] Calling LLM ({FAST_MODEL}) for lesson content.")
        writer = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)
        lesson_generation: LessonGeneration = await writer.chat(
            generation_prompt, response_format=LessonGeneration
        )
        logger.info(f"[{func_name}] LLM call successful. Generated content for {len(lesson_generation.content_for_section)} sections.")
        return lesson_generation
    except Exception as e:
        logger.error(f"[{func_name}] LLM call failed: {e}", exc_info=True)
        raise

async def improve_lesson(
    lesson_generation: LessonGeneration,
    language: str,
    relevant_content: list[str] = None,
) -> LessonGeneration:
    """Improve the content of each section in the lesson using LLM asynchronously, including LaTeX validation and retries.

    Args:
        lesson_generation: The lesson generation object containing sections to improve
        language: The language to write the content in
        relevant_content: Optional list of relevant content to consider
    """
    func_name = "improve_lesson"
    num_sections = len(lesson_generation.title_for_section)
    max_retries_per_section = 3
    logger.info(f"[{func_name}] Starting improvement of {num_sections} sections. Language: {language}. Max LaTeX retries per section: {max_retries_per_section}.")

    # --- Static Prompt Component Blocks (defined once) ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an expert professor specializing in refining and deepening academic content.
Your task is to take an existing lesson section's content and expand it significantly, focusing intensely on its specific topic.
Also fix LaTeX formatting errors, ensuring all math follows the strict LaTeX guidelines and uses only whitelisted commands.
</RoleAndObjective>
"""

    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1.  **Analyze Input:** Understand the `SectionTitle` and `OriginalContent` provided in the user input.
        2.  **Rewrite & Expand:** Rewrite and significantly expand the `OriginalContent` into `improved_content`, focusing *only* on the specific topic of the section.
        3.  **Follow Guidance:** Strictly adhere to the detailed guidance provided in the user input regarding depth, focus, paragraph structure, and formatting.
        4.  **Validate LaTeX:** Ensure all mathematical content strictly follows the LaTeX guidelines, using only whitelisted commands and proper formatting. Address any specific LaTeX errors mentioned in the context.
        5.  **Adhere to Format:** Ensure the final output strictly follows the `ImprovedSection` Pydantic model structure.
    </General>
    {language_instruction_placeholder}
</Instructions>
"""

    DETAILED_IMPROVEMENT_GUIDANCE = """
<DetailedImprovementGuidance>
    <Guideline>Explore the section's specific topic in great depth through multiple connected paragraphs.</Guideline>
    <Guideline>Build a clear progression of ideas around this single focused topic.</Guideline>
    <Guideline>Do not introduce topics belonging to other sections.</Guideline>
    <Guideline>Use markdown formatting extensively to structure the expanded content:</Guideline>
    <Formatting type="Markdown">
        - Headings (`#`, `##`, `###`) only if needed for sub-structuring within the topic.
        - Text emphasis: **bold**, *italics*, ~~strikethrough~~ for key terms/concepts.
        - Lists: ordered, unordered, nested for structured points within paragraphs.
        - Blockquotes (`>`) for definitions or important statements.
        - Tables (Markdown syntax) if appropriate for comparing data *within the topic*.
    </Formatting>
    <Formatting type="LaTeX">
        - Use for mathematical notation: `$inline$` and `$$block$$`.
        - **CRITICAL:** NEVER output raw LaTeX commands (like `\gamma`, `\sum`, `\frac`) outside of these `$ ... $` or `$$ ... $$` delimiters.
        - Only use commands from the <LaTeXWhitelist> section.
        - Never use commands from the <LaTeXBlacklist> section.
        - Follow all guidelines in <LaTeXGuidelines> section.
    </Formatting>
    <Formatting type="Code">
        - Embed code examples using markdown blocks (```language ... ```) if relevant *to this topic*.
    </Formatting>
    <Guideline>Let the exploration unfold naturally through connected ideas and logical flow.</Guideline>
    <Guideline>Use examples and cases that *specifically* illuminate this core topic.</Guideline>
    <Guideline>Keep all discussion centered on the section's stated subject matter.</Guideline>
</DetailedImprovementGuidance>
"""

    CONSTRAINTS = r"""
<Constraints>
    <Constraint name="TopicFocus">Focus *intensely* and *exclusively* on the single topic defined by the SectionTitle and OriginalContent. Do *not* introduce other topics.</Constraint>
    <Constraint name="Depth">Prioritize depth, sustained analysis, and significant expansion over breadth.</Constraint>
    <Constraint name="Structure">Write primarily as well-developed, connected paragraphs. Avoid defaulting to bullet points unless structuring specific lists within the text.</Constraint>
    <Constraint name="Tone">Maintain an academic, professorial tone suitable for university students.</Constraint>
    <Constraint name="WhitelistOnly">Use ONLY LaTeX macros/environments listed in <LaTeXWhitelist>. Items in <LaTeXBlacklist> are FORBIDDEN.</Constraint>
    <Constraint name="NoIndentBlockMath">
        **Never produce `$$ ... $$` in a line that belongs to**
        • list items (`-`, `*`, `+`, `1.`) • nested lists • block quotes `>` • tables • code fences.
        Inside those, always switch to inline `$ ... $`.
        If you want a block equation, end the structure, add a blank line, write the
        flush-left block math, add another blank line, then continue.
    </Constraint>
    <Constraint name="NoInlineDoubleDollar">
        Double-dollar math is forbidden inline; convert to single-dollar.
        Never place `$$ ... $$` inside a paragraph, list, table, or quote.
        `$$` is reserved for standalone block math only.
    </Constraint>
    <Constraint name="DelimiterBalance">Every opening `$` or `$$` MUST have a matching closing delimiter. Never attach delimiters to punctuation or other text.</Constraint>
    <Constraint name="NoHorizontalRules">Avoid markdown horizontal rules: never output lines consisting solely of 3 or more hyphens (`---`), asterisks (`***`), or underscores (`___`). Such separators break downstream PDF rendering.</Constraint>
</Constraints>
"""

    LATEX_WHITELIST = r"""
<LaTeXWhitelist>
Basic Macros (always allowed):
\alpha \beta \gamma \delta \epsilon \varepsilon \zeta \eta \theta \vartheta \iota \kappa \lambda \mu \nu \xi \pi \rho \sigma \tau \upsilon \phi \varphi \chi \psi \omega
\Gamma \Delta \Theta \Lambda \Xi \Pi \Sigma \Upsilon \Phi \Psi \Omega
\times \div \pm \mp \cdot \circ \bullet \oplus \otimes \odot \star \ast \cup \cap \setminus \wedge \vee
\leq \geq \neq \approx \equiv \cong \sim \simeq \propto \prec \succ \preceq \succeq \subset \supset \subseteq \supseteq \in \notin \ni \mapsto \to \gets
\infty \partial \nabla \forall \exists \nexists \emptyset \varnothing \neg \land \lor \implies \impliedby \iff \therefore
\sum \prod \int \oint \iint \iiint \idotsint \bigcup \bigcap \bigoplus \bigotimes \bigodot \biguplus
\frac \dfrac \tfrac \sqrt \vec \overline \underline \widehat \widetilde \overrightarrow \overleftarrow \overbrace \underbrace
\sin \cos \tan \csc \sec \cot \arcsin \arccos \arctan \sinh \cosh \tanh \exp \log \ln \lim \limsup \liminf
\quad \qquad \text \textbf \textit \mathbf \mathrm \mathit \mathbb \mathcal \mathfrak \mathsf \mathtt
\left \right \big \Big \bigg \Bigg \langle \rangle \lceil \rceil \lfloor \rfloor \lbrace \rbrace \lbrack \rbrack \vert \Vert

Block Environments (must be used within $$...$$, flush-left):
\\begin{matrix} ... \\end{matrix}
\\begin{pmatrix} ... \\end{pmatrix}
\\begin{bmatrix} ... \\end{bmatrix}
\\begin{vmatrix} ... \\end{vmatrix}
\\begin{Vmatrix} ... \\end{Vmatrix}
\\begin{cases} ... \\end{cases}
\\begin{aligned} ... \\end{aligned}
\\begin{gathered} ... \\end{gathered}
\\begin{split} ... \\end{split}
\\begin{array}{...} ... \\end{array}
</LaTeXWhitelist>
"""

    LATEX_BLACKLIST = r"""
<LaTeXBlacklist>
These commands/environments break KaTeX and most markdown engines:
- All theorem-like environments (theorem, lemma, proof, etc.)
- All AMS-specific environments (multline, gather, align, etc.)
- All layout/spacing commands (\newline, \linebreak, \pagebreak, etc.)
- All definition/reference commands (\label, \ref, \eqref, \cite, etc.)
- All custom commands (\newcommand, \renewcommand, \def, etc.)
- All font size commands (\tiny, \small, \large, etc.)
- All color commands (\color, \textcolor, \colorbox, etc.)
- All box commands (\fbox, \boxed, \framebox, etc.)
- All margin/indentation commands (\indent, \noindent, \par, etc.)
</LaTeXBlacklist>
"""

    LATEX_GUIDELINES = r"""
<LaTeXGuidelines>
1. **Inline vs Block Math:**
   - Use `$ ... $` for inline math within text.
   - Use `$$ ... $$` for displayed equations, ALWAYS starting at column 0 (no spaces/tabs before `$$`).
   - NEVER indent `$$` - this is absolutely critical and non-negotiable.
   - If you need math in an indented context (lists, quotes, etc.), use inline `$ ... $` instead.

2. **Block Math Indentation:**
   - `$$` MUST begin at column 0 (no spaces/tabs before it).
   - This applies even inside:
     * Unordered lists (*, -, +)
     * Ordered lists (1., 2., etc.)
     * Nested lists (any level)
     * Block quotes (> text)
     * Tables/callouts/admonitions
     * Fenced code blocks
     * ANY line with leading spaces
   - If indentation is unavoidable, convert to inline math using `$ ... $`.

3. **Command Usage:**
   - Use ONLY commands listed in <LaTeXWhitelist>.
   - NEVER use commands listed in <LaTeXBlacklist> (e.g., `\newline`, `\linebreak`).
   - Spell commands correctly (e.g., `\frac`, not `\rac`).
   - Use `\text{...}` for text within math mode.

4. **Delimiter Placement:**
   - Every `$` and `$$` must be properly paired.
   - Don't attach delimiters to punctuation (e.g., not `$x$.` but `$x$`.).
   - Leave space around inline math delimiters for readability.

5. **Block Environments:**
   - Use ONLY environments listed in <LaTeXWhitelist>.
   - Always place environments within `$$...$$` at column 0.
   - Use proper line breaks and spacing within environments.
</LaTeXGuidelines>
"""

    LATEX_EXAMPLES = """
<LaTeXExamples>
Inline Math (Good):
- The formula $\alpha \times \beta$ shows...
- Given $f(x) = x^2$, we find...
- When $\frac{\partial f}{\partial x} = 0$...

Block Math (Good):
$$
\frac{d}{dx} \int_a^x f(t)\,dt = f(x)
$$

In a list:
1. First point
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$
2. Second point

Matrix Example:
$$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$$

Cases Example:
$$
f(x) = \begin{cases}
x^2 & \text{if } x \geq 0 \\
-x^2 & \text{if } x < 0
\end{cases}
$$

Common Errors to Avoid:
- Bad: `The formula \alpha \times \beta shows...` (no delimiters)
- Bad: `$x$.` (delimiter attached to punctuation)
- Bad: `  $$...$$` (indented block math)
- Bad: `\newcommand{\R}{\mathbb{R}}` (custom commands)
- Bad: `\begin{align}...\end{align}` (unsupported environment)
</LaTeXExamples>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the ImprovedSection Pydantic model structure, providing the enhanced content in the `improved_content` field.
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step:
1. Identify the core topic of the section.
2. Analyze the original content for key ideas to expand and any pre-existing LaTeX errors indicated.
3. Brainstorm ways to deepen the analysis and add relevant details/examples *only on this topic*.
4. Review all LaTeX formatting in the planned expanded content:
   - Check against whitelist/blacklist.
   - Verify proper delimiter placement.
   - Ensure block math is never indented.
   - Address any specific LaTeX errors provided in the context.
5. Rewrite and expand the content paragraph by paragraph:
   - Ensure logical flow.
   - Apply formatting guidance.
   - Fix any LaTeX issues during writing.
6. Package the final expanded text into the ImprovedSection structure.
7. Perform final validation using `latex_ok` and retry with specific error feedback if necessary.
</ThinkingProcess>
"""
    # --- End Static Blocks ---

    # --- Define Pydantic Model for Output ---
    class ImprovedSection(BaseModel):
        improved_content: str = Field(description="The improved content of the section")

    # --- Prepare Static Part of System Prompt ---
    language_instruction = f"<TargetLanguageInstruction>Ensure all generated text is in {language.upper()}.</TargetLanguageInstruction>"
    complete_instructions = INSTRUCTIONS_CORE.replace("{language_instruction_placeholder}", language_instruction)

    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        complete_instructions,  # Instructions at the top
        CONSTRAINTS,
        LATEX_WHITELIST,
        LATEX_BLACKLIST,
        LATEX_GUIDELINES,
        LATEX_EXAMPLES,
        OUTPUT_FORMAT,
        complete_instructions,  # Instructions repeated at the end
        THINKING_PROCESS,      # Optional CoT
        "</SystemPrompt>"
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)
    # --- End System Prompt Composition ---

    # --- Prepare Relevant Content Input (once) ---
    relevant_content_input = ""
    citation_instruction = ""
    if relevant_content:
        formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
        relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Reference for context and HEAVY citation):\n{formatted_relevant_content}\n</RelevantContent>"
        citation_instruction = """
        <CitationRequirement>
        **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
        - You MUST heavily cite the provided `<RelevantContent>` within the generated `improved_content`.
        - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes.
        - Format citations like this:
          > "[Quote or paraphrased summary]"
        - Integrate these citations naturally and frequently throughout the improved content to explicitly show reliance on the provided material.
        - Aim to include **multiple citations** where applicable.
        </CitationRequirement>
        """

    target_language_input = f"<TargetLanguage>Target Language: {language.upper()}</TargetLanguage>"

    # --- Inner Helper Function for Section Improvement and Validation ---
    async def _improve_and_validate_section(
        section_index: int,
        title: str,
        original_content: str,
    ) -> str:
        helper_func_name = f"{func_name}._improve_and_validate_section"
        logger.info(f"[{helper_func_name}] Processing section {section_index+1}/{num_sections}: '{title}'")

        # Create a dedicated LLM instance for **each** section to avoid
        # shared-state corruption when running tasks concurrently.
        local_improver = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)

        current_content = original_content  # Start with original content
        initial_latex_error_context = ""

        # 1. Initial LaTeX Check on original content
        try:
            ok, log = await asyncio.to_thread(latex_ok, original_content) # Run in thread
            if not ok:
                logger.warning(f"[{helper_func_name}] Initial LaTeX check failed for section {section_index+1}. Log:\n{log}")
                initial_latex_error_context = (
                    f"<InitialLatexErrorContext>The original content provided had LaTeX errors. "
                    f"Please fix these errors while expanding the content. Error Log:\n{log}\n"
                    f"Focus on adhering to the <LaTeXGuidelines>, <LaTeXWhitelist>, and <LaTeXBlacklist>.</InitialLatexErrorContext>"
                )
        except Exception as e:
             logger.error(f"[{helper_func_name}] Error during initial latex_ok check for section {section_index+1}: {e}", exc_info=True)
             # Proceed without initial error context if check fails internally

        # 2. First LLM Call (Expansion/Improvement)
        section_title_input = f"<SectionTitle>{title}</SectionTitle>"
        original_content_input = f"<OriginalContent>\n{original_content}\n</OriginalContent>" # Use original for first call
        final_instruction_input_base = "<FinalInstruction>Generate the ImprovedSection object according to the System Prompt and detailed improvement guidance, focusing intensely on the section's specific topic and expanding significantly on the OriginalContent provided above. Ensure all LaTeX formatting strictly follows the guidelines. Adhere strictly to the citation requirement if relevant content is provided.</FinalInstruction>"

        # Prepare dynamic citation instruction for this specific call
        current_citation_instruction = ""
        current_relevant_content_input = ""
        if relevant_content:
            formatted_relevant_content = "\n".join([f"  - {item}" for item in relevant_content])
            current_relevant_content_input = f"<RelevantContent>\nRelevant User-Provided Content (Reference for context and HEAVY citation):\n{formatted_relevant_content}\n</RelevantContent>"
            current_citation_instruction = """
            <CitationRequirement>
            **CRITICAL REQUIREMENT: HEAVY CITATION NEEDED**
            - You MUST heavily cite the provided `<RelevantContent>` within the generated `improved_content`.
            - Whenever incorporating information or ideas directly from `<RelevantContent>`, clearly attribute it using Markdown blockquotes.
            - Format citations like this:
              > "[Quote or paraphrased summary]"
            - Integrate these citations naturally and frequently throughout the improved content to explicitly show reliance on the provided material.
            - Aim to include **multiple citations** where applicable.
            </CitationRequirement>
            """

        generation_prompt_parts_first = [
            section_title_input,
            original_content_input,
            target_language_input,
            current_relevant_content_input, # Use dynamically generated relevant content input
            current_citation_instruction, # Use dynamically generated citation instruction
            initial_latex_error_context, # Include if original had errors
            DETAILED_IMPROVEMENT_GUIDANCE,
            final_instruction_input_base
        ]
        generation_prompt_first = "\n".join(filter(None, generation_prompt_parts_first))

        try:
            logger.info(f"[{helper_func_name}] Calling LLM for initial improvement (Section {section_index+1}).")
            result: ImprovedSection = await local_improver.chat(
                generation_prompt_first, response_format=ImprovedSection
            )
            current_content = result.improved_content
            logger.info(f"[{helper_func_name}] Initial improvement successful (Section {section_index+1}).")
        except Exception as e:
            logger.error(f"[{helper_func_name}] LLM call failed during initial improvement for section {section_index+1}: {e}. Returning original content.", exc_info=True)
            # Log the content being returned
            logger.debug(f"[{helper_func_name}] Returning original content for section {section_index+1}: '{original_content[:100]}...' ({len(original_content)} chars)")
            return original_content # Fallback to original if first call fails

        # 3. Post-Generation Check & Retry Loop
        for attempt in range(max_retries_per_section + 1):
            logger.info(f"[{helper_func_name}] Performing LaTeX check (Attempt {attempt+1}/{max_retries_per_section+1}) for section {section_index+1}.")
            try:
                # Run heavy pandoc/XeLaTeX check in thread pool
                ok_latex, log_latex = await asyncio.to_thread(latex_ok, current_content)
                # Run lightweight KaTeX-style delimiter check synchronously (fast)
                from backend.utils import markdown_math_ok  # local import to avoid circular
                ok_md, log_md = markdown_math_ok(current_content)

                if ok_latex and ok_md:
                    logger.info(f"[{helper_func_name}] Validation successful for section {section_index+1} on attempt {attempt+1} (LaTeX+Markdown).")
                    return current_content

                # Compose combined log of failures
                combined_log_parts = []
                if not ok_latex:
                    combined_log_parts.append("LaTeX validation errors:\n" + log_latex)
                if not ok_md:
                    combined_log_parts.append("Markdown math delimiter errors:\n" + log_md)
                combined_log = "\n\n".join(combined_log_parts)

                logger.warning(f"[{helper_func_name}] Validation failed for section {section_index+1} (Attempt {attempt+1}). Logs:\n{combined_log}")

                log = combined_log  # reuse variable for retry context
                if attempt == max_retries_per_section:
                    logger.error(f"[{helper_func_name}] Max retries ({max_retries_per_section}) reached for LaTeX validation on section {section_index+1}. Returning last generated content despite errors.")
                    # Log the content being returned
                    logger.debug(f"[{helper_func_name}] Returning last generated (failed validation) content for section {section_index+1}: '{current_content[:100]}...' ({len(current_content)} chars)")
                    return current_content
                else:
                    # Prepare for retry
                    logger.info(f"[{helper_func_name}] Preparing LaTeX fix retry {attempt+1} for section {section_index+1}.")
                    # NEW: Emphasize simplification
                    retry_latex_error_context = (
                        f"<RetryLatexErrorContext>The previous generation attempt failed LaTeX validation. "
                        f"Error Log (may only show first error):\n{log}\n"
                        f"CRITICAL INSTRUCTION: Rewrite the *entire* section below, focusing on SIGNIFICANTLY SIMPLIFYING **ALL** LaTeX expressions. "
                        f"Avoid complex structures, nested fractions, or unusual commands. Prioritize passing validation over exact mathematical representation. "
                        f"Review **all** math, not just the part in the log. Use only basic, whitelisted LaTeX as per guidelines."
                        f"</RetryLatexErrorContext>"
                    )
                    # Use the FAILED content as the new "original" for the retry prompt
                    failed_content_input = f"<OriginalContent>\n{current_content}\n</OriginalContent>"

                    # NEW: Modify final instruction for retry
                    final_instruction_retry = (
                        f"<FinalInstruction>Generate the ImprovedSection object according to the System Prompt and detailed improvement guidance. "
                        f"Address the LaTeX errors reported above by **simplifying all mathematical notation throughout the OriginalContent** to ensure it passes validation. "
                        f"Strictly adhere to the LaTeX guidelines. Also, remember to adhere strictly to the citation requirement if relevant content is provided.</FinalInstruction>" # Added citation reminder
                    )

                    generation_prompt_parts_retry = [
                        section_title_input,
                        failed_content_input, # Provide the failed content
                        target_language_input,
                        current_relevant_content_input, # Pass relevant content again
                        current_citation_instruction, # Pass citation instruction again
                        retry_latex_error_context, # Specific retry instructions emphasizing simplification
                        DETAILED_IMPROVEMENT_GUIDANCE, # Repeat guidance
                        final_instruction_retry # Use the modified final instruction
                    ]
                    generation_prompt_retry = "\n".join(filter(None, generation_prompt_parts_retry))

                    logger.info(f"[{helper_func_name}] Calling LLM for LaTeX fix (Retry {attempt+1}, Section {section_index+1}).")
                    # Nested try-except for the retry LLM call
                    try:
                         retry_result: ImprovedSection = await local_improver.chat(
                             generation_prompt_retry, response_format=ImprovedSection
                         )
                         current_content = retry_result.improved_content # Update content for next check
                         logger.info(f"[{helper_func_name}] LLM LaTeX fix attempt {attempt+1} successful (Section {section_index+1}).")
                    except Exception as retry_e:
                         logger.error(f"[{helper_func_name}] LLM call failed during LaTeX fix retry {attempt+1} for section {section_index+1}: {retry_e}. Continuing loop with previous content.", exc_info=True)
                         # Do not return here, let the loop continue to potentially return the last known good/bad content after max retries
                         if attempt == max_retries_per_section:
                             logger.error(f"[{helper_func_name}] LLM call failed on final LaTeX fix retry for section {section_index+1}. Returning content from before this failed call.")
                             logger.debug(f"[{helper_func_name}] Returning content prior to final failed retry for section {section_index+1}: '{current_content[:100]}...' ({len(current_content)} chars)")
                             return current_content # Return the content *before* this failed retry call

            except Exception as e:
                 logger.error(f"[{helper_func_name}] Error during latex_ok check for section {section_index+1} (Attempt {attempt+1}): {e}", exc_info=True)
                 if attempt == max_retries_per_section:
                     logger.error(f"[{helper_func_name}] Error on final latex_ok check attempt for section {section_index+1}. Returning last generated content.")
                     # Log the content being returned
                     logger.debug(f"[{helper_func_name}] Returning last generated content after failed final check for section {section_index+1}: '{current_content[:100]}...' ({len(current_content)} chars)")
                     return current_content # Return last known content if check itself fails on last attempt
                 # Continue to next attempt if check fails before max retries

        # Should theoretically not be reached if loop logic is correct
        logger.error(f"[{helper_func_name}] Reached end of function unexpectedly for section {section_index+1}. Returning last generated content.")
        # Log the content being returned
        logger.debug(f"[{helper_func_name}] Returning last generated content (unexpected exit) for section {section_index+1}: '{current_content[:100]}...' ({len(current_content)} chars)")
        return current_content
    # --- End Inner Helper Function ---


    # --- Main Execution Logic ---
    improved_content_list: list[str] = []
    tasks = []

    logger.info(f"[{func_name}] Creating {num_sections} parallel improvement tasks using helper function.")

    for i, (title, content) in enumerate(
        zip(
            lesson_generation.title_for_section,
            lesson_generation.content_for_section,
        )
    ):
        tasks.append(
            _improve_and_validate_section(
                section_index=i,
                title=title,
                original_content=content,
            )
        )

    try:
        logger.info(f"[{func_name}] Gathering results from {len(tasks)} improvement tasks.")
        improved_content_list = await asyncio.gather(*tasks)
        logger.info(f"[{func_name}] Successfully gathered results for {len(improved_content_list)} sections.")

        # Basic check: Ensure we got the same number of sections back
        if len(improved_content_list) != num_sections:
             logger.error(f"[{func_name}] Mismatch in number of sections returned ({len(improved_content_list)}) vs expected ({num_sections}). Raising error.")
             raise ValueError("Number of improved sections does not match original number.")

        final_lesson_generation = LessonGeneration(
            title_for_section=lesson_generation.title_for_section, # Keep original titles
            content_for_section=improved_content_list, # Use validated/improved content
        )
        return final_lesson_generation
    except Exception as e:
        logger.error(f"[{func_name}] Failed to gather improvement results: {e}", exc_info=True)
        raise


async def write_presentation_markdown(content: str, language: str, extra_instructions: str = None, ai_images: bool = False) -> str:
    """Generate a full Pandoc-compatible Markdown presentation from raw content."""

    # Debug log for ai_images flag
    logger.info("\n\n------\nstart log\nidentifier debug write_presentation_markdown ai_images\nvalue:\n{}\n------\n\n".format(ai_images))

    # Conditionally define the role objective based on ai_images
    if ai_images:
        ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an expert academic content creator and presentation designer AI.
Your task is to convert a block of input text content into a single, complete,
and well-structured Pandoc Markdown document suitable for PPTX conversion.
When generating image prompts, you act as a meticulous technical illustrator or visual designer, focusing on clarity and utility.
</RoleAndObjective>
"""
    else:
        ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an expert academic content creator and presentation designer AI.
Your task is to convert a block of input text content into a single, complete,
and well-structured Pandoc Markdown document suitable for PPTX conversion.
</RoleAndObjective>
"""

    INSTRUCTIONS_CORE = """
<Instructions>
  <General>
    1. Analyze `<InputContent>` to identify core themes and logical flow.
    2. Structure the presentation into slides following these guidelines:
       - The VERY FIRST slide MUST be the ONLY title-only slide (a single `# Heading` with no other content) in the entire presentation.
       - All remaining slides MUST include content beyond a heading and can be either of two slide types:
         • Text slides – paragraphs, LaTeX formulas, code blocks, extended explanations, etc.
         • Bullet/numbered list slides – concise summaries, step-by-step processes, key points.
       - Under NO circumstance should another title-only slide appear after the first slide.
    3. Separate each slide with "---" on its own line.
    4. Use only syntax allowed by the Pandoc guide. No excluded features, including no `$begin:math:text$...$end:math:text$` or `$begin:math:display$…$end:math:display$`, and no raw `\|` macros.
    5. Apply the stylistic guidance if applicable (code blocks, LaTeX, varied slide types).
    6. Output a *single* raw Markdown string. No code fences. No commentary on the output.
  </General>
</Instructions>
"""

    DESIRED_OUTPUT = """
<DesiredOutput>
  <Goal>Produce a complete Pandoc Markdown presentation based on the `<InputContent>`.</Goal>
  <Structure>
    <SlideCount>Generate AT LEAST 10 slides (meaning 9 or more `---` separators).</SlideCount>
    <FirstSlide>Start the presentation with a title slide (e.g., `# Presentation Topic`). This slide MUST only contain the main title (a single `# Heading`) followed immediately by `---`. This title-only format is PERMITTED ONLY for the FIRST slide and PROHIBITED for all subsequent slides.</FirstSlide>
    <SlideVariety>
      <TextSlides>Include at least 3-4 text-heavy slides for detailed explanations, code examples (if applicable), LaTeX formulas (if applicable), or complex concepts.</TextSlides>
      <OtherSlides>Use bullet points or numbered lists for the remaining slides to summarize key points or list items. Include existing images or LaTeX if they are directly relevant and necessary for the content.</OtherSlides>
    </SlideVariety>
    <TitleSlideConstraint>Strictly enforce that ONLY the very first slide can be a title-only slide (just `# Heading` followed by `---`). All other slides MUST contain additional content (text, lists, code, images, etc.) besides any headings.</TitleSlideConstraint>
  </Structure>
  <Quality>Ensure the content and structure are suitable for a university-level presentation. Maintain clarity, accuracy, and logical flow. The tone should be academic and informative.</Quality>
  <Format>Output *only* the raw Pandoc Markdown string, strictly following the `<PandocMarkdownForPptxGuide>` and the `--slide-level=0` constraint (using `---` surrounded by blank lines as the sole slide separator).</Format>
  <StrictRequirement>The final presentation MUST have at least 10 slides.</StrictRequirement>
  <StrictRequirement>ABSOLUTELY NO title-only slides after the first slide. Every slide after the first MUST have content beyond just a heading.</StrictRequirement>
</DesiredOutput>
"""

    # Conditionally add constraint about *not* generating images
    if not ai_images:
        CONSTRAINTS = """
<Constraints>
  <OutputFormat>Raw Markdown only.</OutputFormat>
  <SlideSeparation>`---` on its own line is the only slide delimiter.</SlideSeparation>
  <OutputRequirements>Follow the '<DesiredOutput>' instructions.</OutputRequirements>
  <SlideMinimum>The presentation MUST contain at least 10 slides.</SlideMinimum>
  <Constraint name="NoNewImages">DO NOT generate any new image placeholders using the `![...](...).png` syntax. Only include image links if they were explicitly present in the `<InputContent>`.</Constraint>
</Constraints>
"""
    else:
        # Original constraints when AI images are allowed
        CONSTRAINTS = """
<Constraints>
  <OutputFormat>Raw Markdown only.</OutputFormat>
  <SlideSeparation>`---` on its own line is the only slide delimiter.</SlideSeparation>
  <OutputRequirements>Follow the '<DesiredOutput>' instructions.</OutputRequirements>
  <SlideMinimum>The presentation MUST contain at least 10 slides.</SlideMinimum>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Return the complete Markdown in the assistant message *without* any wrapping
triple-backticks or additional explanations.
</OutputFormat>
"""

    PANDOC_PPTX_MARKDOWN_GUIDE = r"""
<PandocMarkdownForPptxGuide>
  <Overview>
    This guide details the Pandoc Markdown syntax elements that reliably translate into PowerPoint (PPTX) slides when using a conversion process configured with '--slide-level=0' (meaning only horizontal rules create new slides) and '--resource-path=.' (for locating images). Use only these features to ensure predictable and clean PPTX output.
  </Overview>

  <Feature name="Slide Separation">
    <MarkdownSyntax>
      ```markdown
      Content for Slide 1...

      ---

      Content for Slide 2...
      ```
    </MarkdownSyntax>
    <PptxResult>
      A line containing exactly '---' surrounded by blank lines creates a hard slide break, starting a new slide.
    </PptxResult>
    <UsageNotes>
      This is the ONLY way to create new slides with the current configuration ('--slide-level=0'). Headings (#, ##, etc.) will render as text within the current slide, not start new ones.
    </UsageNotes>
  </Feature>

  <Feature name="Basic Text Formatting">
    <MarkdownSyntax>
      ```markdown
      *Italic* or _Italic_
      **Bold** or __Bold__
      ~~Strikethrough~~
      Superscript: E=mc^2^
      Subscript: H~2~O
      Inline Code: `variable_name`
      Hard Line Break: End line with two spaces or \\
      ```
    </MarkdownSyntax>
    <PptxResult>
      Applies standard text formatting (italics, bold, strikethrough, super/subscript, monospaced code style). Hard line breaks create line breaks within a paragraph.
    </PptxResult>
    <UsageNotes>
      Use for standard text emphasis and simple formatting within paragraphs.
    </UsageNotes>
  </Feature>

  <Feature name="Bullet Lists">
    <MarkdownSyntax>
      ```markdown
      - Item 1
      - Item 2
        - Sub-item 2a

      * Item A (Use -, *, or +)

      * Loose Item B (Separated by blank line)
      ```
    </MarkdownSyntax>
    <PptxResult>
      Creates standard bulleted lists. Indentation creates nested levels. Blank lines between items ('loose list') add extra vertical spacing in PPTX.
    </PptxResult>
    <UsageNotes>
      Ideal for enumerating points without a specific order. Use loose lists for better readability if items are long.
    </UsageNotes>
  </Feature>

  <Feature name="Ordered Lists">
    <MarkdownSyntax>
      ```markdown
      1. First item
      2. Second item
         a. Sub-item a
      #. Auto-numbered next item
      ```
    </MarkdownSyntax>
    <PptxResult>
      Creates numbered or lettered lists. Pandoc handles the numbering sequence.
    </PptxResult>
    <UsageNotes>
      Use when the order or sequence of items is important. Use '#.' to continue numbering automatically.
    </UsageNotes>
  </Feature>

  <Feature name="Code Blocks">
    <MarkdownSyntax>
      ```python
      def main():
          print("Hello")
      ```
    </MarkdownSyntax>
    <PptxResult>
      Renders as a preformatted block of text, typically with a monospaced font (controlled by 'monofont' metadata or reference doc). Syntax highlighting may be applied if the reference doc is configured for it. Avoid complex attributes on the fence (like line numbers or custom styles) for reliability.
    </PptxResult>
    <UsageNotes>
      Best for displaying multi-line code snippets clearly. Ensure the language identifier (e.g., 'python') is correct.
    </UsageNotes>
  </Feature>

  <Feature name="Images">
    <MarkdownSyntax>
      ```markdown
      ![Alt text describing the image](image.png)
      ```
    </MarkdownSyntax>
    <PptxResult>
      Embeds the specified image file (found via '--resource-path'). If an image is the only content in a paragraph, its alt text becomes a figure caption below it.
    </PptxResult>
  </Feature>

  <Feature name="Links">
    <MarkdownSyntax>
      ```markdown
      Inline: [Pandoc Website](https://pandoc.org)
      Reference: [Example][ref]
      Auto-link: <https://example.com>

      [ref]: https://example.com "Optional Tooltip"
      ```
    </MarkdownSyntax>
    <PptxResult>
      Creates clickable hyperlinks within the text.
    </PptxResult>
    <UsageNotes>
      Use to link to external resources or websites.
    </UsageNotes>
  </Feature>

  <Feature name="Math Equations">
    <MarkdownSyntax>
      ```markdown
      Inline math: $E = mc^2$
      Display math:
      $$
      \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
      $$
      ```
    </MarkdownSyntax>
    <PptxResult>
      Renders mathematical formulas using PowerPoint's native Office Math (OMML) format.
    </PptxResult>
    <UsageNotes>
      Use only `$…$` for inline math and `$$…$$` for display math.
      Do not use `$begin:math:text$...$end:math:text$` or `$begin:math:display$…$end:math:display$`.
      Remove any `\|…\|` instances entirely.
    </UsageNotes>
  </Feature>

  <ExcludedFeatures>
    Note: The following features were EXCLUDED as they proved unreliable or incompatible with the strict '--slide-level=0' conversion: Speaker Notes (`::: notes`), Incremental Lists (`::: incremental`), Layout Divs/Columns (`::: {.columns}`), Task Lists (`- [ ]`), Definition Lists (`Term:\\n: Def`), Footnotes (`[^1]`), Jupyter Snippets (``` ipython ```), and Tables (both pipe `|...|` and grid `+---+`). PROHIBITED using these.
  </ExcludedFeatures>

</PandocMarkdownForPptxGuide>
"""

    PRESENTATION_STYLE_GUIDE = """
<PresentationStyleGuide>
  <Overview>
    Follow these stylistic guidelines IN ADDITION to the technical Pandoc syntax rules to create engaging, informative, and structurally varied presentation content suitable for a university-level audience.
    **Core Principle:** Your primary role is to *format* the provided `<InputContent>` into a presentation structure. Do NOT invent new substantive content. Use the existing text, code, formulas, etc., verbatim.
  </Overview>

  <Feature name="Content Adaptation">
    <Guideline>Focus on restructuring the `<InputContent>` into slides. Do not add information not present in the original text.</Guideline>
    <Guideline>Translate existing content faithfully. If the input contains code blocks, LaTeX formulas, or links (to websites or images), include them exactly as they appear.</Guideline>
    <Guideline>**Handling Input Tables:** Tables are NOT allowed in the output format (see `<PandocMarkdownForPptxGuide>`). If the `<InputContent>` contains a Markdown table (e.g., using `|` or `+---+`), you MUST NOT replicate the table structure. Instead, you MUST extract the information from the input table and present it using allowed elements like bullet points, definition lists (if appropriate, though generally less preferred), or descriptive paragraphs. The goal is to convey the same information without using the forbidden table syntax.</Guideline>
  </Feature>

  <Feature name="Code Blocks">
    <Guideline>Use fenced code blocks (```language ... ```) **proactively** if present in the `<InputContent>` or whenever discussing programming, algorithms, data structures, commands, configurations, etc., based *directly* on the input.</Guideline>
    <Guideline>Select the correct language identifier (e.g., `python`, `java`, `bash`).</Guideline>
    <Guideline>Ensure code snippets are copied verbatim from the input if provided.</Guideline>
  </Feature>

  <Feature name="LaTeX Math">
    <Guideline>Use LaTeX math syntax (`$...$` and `$$...$$`) **proactively** if present in the `<InputContent>` or when discussing mathematics, physics, formulas, complexity (e.g., O($n^2$)), etc., based *directly* on the input.</Guideline>
    <Guideline>Use inline `$ ... $` for symbols/expressions within text.</Guideline>
    <Guideline>Use display `$$ ... $$` for standalone equations.</Guideline>
    <Guideline>Ensure formulas are copied verbatim from the input if provided.</Guideline>
  </Feature>

  <Feature name="Links and Existing Images">
    <Guideline>Include any hyperlinks (`[text](url)`) or image links (`![alt](path/to/image.png){...}`) present in the `<InputContent>` verbatim.</Guideline>
    <Guideline>For existing images, prefer placing the image markdown on a slide with minimal other content (perhaps just a title heading). An image often dominates a slide, making other content small or poorly formatted.</Guideline>
    <Guideline>Example of using an existing image link on its own slide:
      ```markdown
      ---

      # Diagram Overview

      ![Flowchart of the process](https_link_to_image)

      ---

      ## Next Steps...
      ```
    </Guideline>
  </Feature>

  <Feature name="Slide Structure Variety (Implied via Markdown)">
    <Guideline>Vary the Markdown structure between slides (separated by `---`) to create different perceived slide types, using the adapted content.</Guideline>
    <Guideline>**First Title Slide (ONLY):** The very first slide MUST be a title-only slide (e.g., `# Main Topic Introduction`) followed immediately by `---`. This format is STRICTLY FORBIDDEN for any other slide in the presentation.</Guideline>
    <Guideline>**Subsequent Slides:** ALL slides AFTER the first MUST contain content beyond just a heading. This includes bullet points (`-`, `*`, `1.`), paragraphs, code blocks, images, or LaTeX formulas derived from the input.</Guideline>
    <Guideline>**Bullet Point Slides:** Use Markdown lists (`-`, `*`, `1.`) for concise summaries, key takeaways, feature lists, or steps derived from the input.</Guideline>
    <Guideline>**Content-Rich Slides:** Use paragraphs for in-depth explanations, analysis, or context derived from the input.</Guideline>
    <Guideline>Alternate slide types (bullet points, content-rich, image slides) to maintain engagement, remembering the strict rule against title-only slides after the first one.</Guideline>
  </Feature>

  <Feature name="Rich Text Formatting">
    <Guideline>Employ Markdown formatting (`**bold**`, `*italic*`, `` `code` ``) purposefully to emphasize key terms, definitions, or code elements found within the `<InputContent>`.</Guideline>
    <Guideline>Apply formatting strategically to guide the reader's eye based on the structure and emphasis potentially implied in the input text.</Guideline>
  </Feature>

</PresentationStyleGuide>
"""


    AI_IMAGES_THINKING_PROCESS = """<AIImageThinkingProcess>For AI images: Identify a key concept needing visual aid → meticulously craft a highly detailed, specific prompt focusing on utility and clarity → place image placeholder strategically.</AIImageThinkingProcess>"""
    THINKING_PROCESS = f"""
<ThinkingProcess>
Think step-by-step: analyze content → plan slide outline → write slides applying guide & style → final self-check → output Markdown.
{AI_IMAGES_THINKING_PROCESS if ai_images else ''}
</ThinkingProcess>"""

    LANGUAGE_INSTRUCTION = f"""
<TargetLanguageInstruction>Write all narrative text in {language.upper()}.</TargetLanguageInstruction>
"""

    # Consolidated AI Image Generation Rules (conditionally included)
    AI_IMAGE_GENERATION_RULES = r"""
<AIImageGenerationRules>

  <MandatoryPlaceholderRequirement>
    If the `<InputContent>` lacks pre-existing image links (`![...](...)`), one slide containing a placeholder for an AI-generated image MUST be included. Choose a suitable location where it adds the most value to break up text or illustrate a key point. This is only active if AI image generation is enabled.
  </MandatoryPlaceholderRequirement>

  <GeneratingNewImagesFeature>
    <Guideline>If the `<InputContent>` lacks visual elements AND you identify a specific point where an image would significantly enhance understanding or engagement (e.g., illustrating a complex concept, visualizing data flow, showing a specific structure), you MAY generate a placeholder for an image.</Guideline>
    <Guideline>Focus on generating **useful, didactic images** that directly support the academic content. Avoid purely decorative or "cool" images that don't add informational value.</Guideline>
    <Guideline>Use the following format ONLY for generating NEW images: `![DETAILED_PROMPT_FOR_IMAGE_GENERATION](meaningful_filename.png)`</Guideline>
    <Guideline>The `DETAILED_PROMPT_FOR_IMAGE_GENERATION` in the alt text (`[]`) is **CRITICAL**. It must be **exceptionally detailed and precise**, leaving no room for ambiguity. Refer to the `<ImageGenerationGuideline>` below for how to write effective prompts.</Guideline>
    <Guideline>The `meaningful_filename.png` should be simple, descriptive, and use underscores (e.g., `data_pipeline_overview.png`, `neuron_structure_labeled.png`).</Guideline>
    <Guideline>Place the generated image markdown strategically, often on its own slide or paired with very concise text to maximize its impact.</Guideline>
    <Guideline>Beyond the mandatory image (if required), do NOT generate additional images gratuitously. Only add them where they provide clear, specific value to understanding the content.</Guideline>
    <DosAndDonts>
      <Do>Write extremely descriptive, specific prompts mentioning style, subject, ALL key components, labels, relationships, colors, lighting, and desired level of detail. Aim for prompts that read like technical specifications.</Do>
      <ExampleDo>`![Clean vector diagram illustrating the Krebs cycle. Show all major intermediates (Citrate, Isocitrate, α-Ketoglutarate, Succinyl-CoA, Succinate, Fumarate, Malate, Oxaloacetate) as labeled chemical structures within circular arrows indicating cycle flow. Highlight ATP, NADH, and FADH2 production points with distinct icons and labels. Use a clear, academic style with a white background.](krebs_cycle_diagram_vector.png)`</ExampleDo>
      <ExampleDo>`![Photorealistic close-up image of a titration experiment setup. Show a burette filled with a clear titrant dripping into an Erlenmeyer flask containing a pink solution (indicating phenolphthalein endpoint). Include realistic reflections on the glassware, a magnetic stirrer bar visible in the flask, and a blurred laboratory background. Lighting should be bright and clinical.](titration_endpoint_photorealistic.png)`</ExampleDo>
      <Dont>Use vague placeholders, overly simple descriptions, or prompts that only mention the general topic.</Dont>
      <ExampleDont>`![placeholder for image about Krebs cycle](krebs_cycle.png)`</ExampleDont>
      <ExampleDont>`![image of titration](titration.png)`</ExampleDont>
      <ExampleDont>`![Diagram of a process](diagram.png)`</ExampleDont>
      <ExampleDont>`![Chart showing results](chart.png)`</ExampleDont>
    </DosAndDonts>
    <Example>
      ```markdown
      # Concept Visualization: Neural Network Layer

      ---

      ![Detailed vector illustration of a single artificial neuron layer within a feedforward neural network. Show 3 input nodes on the left, 4 neuron nodes in the center layer, and 2 output nodes on the right. Draw weighted connection lines (varying thickness) from every input node to every neuron node, and from every neuron node to every output node. Label one neuron node clearly showing inputs (x1, x2, x3), weights (w1, w2, w3), a summation symbol (Σ), an activation function symbol (e.g., sigmoid curve labeled 'σ'), and the output (y). Use a clean, technical diagram style with blue nodes and grey connection lines on a white background.](neural_network_layer_detailed_vector.png)

      ---

      ## Layer Functionality Explained
      ... text explaining the layer based on the diagram ...
      ```
    </Example>
  </GeneratingNewImagesFeature>

  <ImageGenerationGuideline>
    <Overview>
      **CRITICAL REQUIREMENT:** Image generation prompts MUST be **exceptionally detailed, specific, precise, and lengthy**. Your goal is NOT brevity, but absolute clarity for the image model. Generate prompts that act as unambiguous specifications for a useful, informative visual. Focus on **utility** over generic appeal.
      Meticulously define the subject, style, mood, lighting, composition, perspective, colors, textures, and **ALL specific elements, labels, and relationships** required. Describe the image as if instructing a human technical illustrator who needs every detail explicitly stated.
      The prompt goes into the alt text `[]` of the Markdown image link.
    </Overview>
    <Requirement name="Prompt Detail Level">
      <Rule>Prompts MUST be highly descriptive, often multiple sentences or a detailed paragraph long. Leave **nothing** to interpretation.</Rule>
      <Rule>For didactic images (charts, diagrams, technical illustrations, graphs, schematics): Be **extremely specific** about every element.
          - **Charts/Graphs:** Specify chart type (bar, line, scatter), exact data to be represented (even if illustrative, describe the trend/shape), axis labels (precise text), data point appearance, colors, legends, gridlines, and overall style (e.g., "academic publication style", "clean infographic style").
          - **Diagrams/Schematics:** Specify all components, their spatial relationships, connection lines/arrows (indicating flow/interaction), required labels (exact text and placement), color-coding, style (e.g., "clean vector style", "hand-drawn schematic", "blueprint style"), and background.
      </Rule>
      <Rule>Vague prompts like "image of a process," "chart showing data," "diagram of system," or "illustrate concept X" are **STRICTLY PROHIBITED**. You MUST describe *what* the process looks like, *what* data the chart shows and *how*, *what* components the diagram includes and *how* they connect, or *how* concept X should be visually represented.</Rule>
    </Requirement>
    <PromptStructure>
      <Part name="Subject">
        Describe the main subject, setting, action, and **ALL key elements and their interactions** in intricate detail. What exactly should be depicted?
      </Part>
      <Part name="Style">
        Specify art style (e.g., photorealistic, vector art, schematic diagram, watercolor, blueprint), medium, or visual aesthetic precisely. Choose a style appropriate for academic/technical content (often vector or schematic).
      </Part>
      <Part name="Composition & Perspective">
        Define the layout, camera angle (e.g., close-up, isometric view, top-down), zoom level, and arrangement of elements meticulously.
      </Part>
      <Part name="Details & Labels">
        Include specific color palettes, textures, object relationships, lighting conditions (e.g., bright, even lighting for diagrams), and **crucially, any required text labels, annotations, or symbols within the image.** Specify font style if important (e.g., "clear sans-serif font for labels").
      </Part>
    </PromptStructure>
    <AdvancedTechniques>
      <ChainOfThought>
        For complex scenes/diagrams, mentally outline the core components -> specify connections/relationships -> add labels -> define style and polish.
      </ChainOfThought>
      <RolePrompting>
        Adopt the persona: "Generate an image as an expert technical illustrator..." or "Generate an image as a data visualization specialist..." to reinforce the focus on clarity and precision.
      </RolePrompting>
    </AdvancedTechniques>
    <Examples>
      <!-- These examples demonstrate the required level of extreme detail and specificity -->
      ![A detailed misty forest landscape at dawn depicted in a realistic oil painting style. Warm, golden sunlight filters dramatically through the canopy of towering, ancient pine trees, illuminating the swirling fog on the forest floor. The color palette is rich with deep greens, earthy browns, and vibrant golds. The perspective is a low camera angle looking upwards towards the light, emphasizing the height of the trees.](misty_forest_dawn_oil_painting.png)
      ![A high-resolution watercolor illustration capturing a lone medieval knight in intricately detailed plate armor standing contemplatively atop a misty hill at sunrise. The background shows rolling hills fading into the mist. The armor exhibits realistic metallic textures with subtle reflections. The color palette uses soft pastels (pinks, oranges, light blues) for the sky and mist, contrasting with the darker metallic tones of the armor. Lighting is cinematic and soft, emanating from the rising sun.](medieval_knight_watercolor_sunrise.png)
      ![Clean vector-style cross-sectional diagram of a standard lithium-ion battery cell, clearly labeling the following components with legible sans-serif text annotations: graphite anode (dark grey rectangle on left), porous separator (thin light grey vertical line), lithium cobalt oxide cathode (blue rectangle on right), copper current collector foil (thin orange layer behind anode), and aluminum current collector foil (thin silver layer behind cathode). Include curved arrows labeled 'Li+' indicating the flow of lithium ions during discharge from anode to cathode through the electrolyte (represented by a light blue background fill between separator and cathode). Designed for a technical presentation slide, white background, no shadows.](lithium_ion_battery_diagram_vector_labeled.png)
      ![Mathematically accurate plot of the probability density function (PDF) of a Gaussian (normal) distribution curve, rendered in a clean academic style suitable for publication. The x-axis is labeled 'Value (x)' and the y-axis is labeled 'Probability Density f(x)'. The bell curve is smooth, symmetrical, and colored dark blue, centered at the mean, which is marked and labeled on the x-axis with the Greek letter μ. The standard deviation is indicated by horizontal lines extending from the mean to the inflection points, marked with the Greek letter σ. Include the full LaTeX equation for the PDF, $f(x | \mu, \sigma^2) = \frac{1}{\sqrt{2\pi\sigma^2}} e^{ -\frac{(x-\mu)^2}{2\sigma^2} }$, rendered clearly and legibly above the main plot area. Use subtle grey grid lines. White background.](normal_distribution_pdf_plot_annotated.png)
      ![Professional vector infographic illustrating the request/response lifecycle in the FastAPI web framework using 5 distinct stages arranged horizontally left-to-right with clear connecting arrows. Stage 1: 'HTTP Request Reception' (icon: stylized network symbol receiving an arrow). Stage 2: 'Dependency Injection & Data Validation' (icon: interlocking puzzle pieces with checkmarks). Stage 3: 'Path Operation Function Execution' (icon: Python logo with 'running' motion lines). Stage 4: 'Response Model Serialization' (icon: data structure transforming into JSON symbol). Stage 5: 'HTTP Response Transmission' (icon: stylized network symbol sending an arrow). Each stage must have its title label clearly below its icon using a sans-serif font. Use a modern, flat design aesthetic with a primary color scheme of FastAPI green (#05998b) and a secondary blue (#4a90e2). White background.](fastapi_request_lifecycle_infographic_vector.png)
      ![Photorealistic, high-detail macro photograph capturing a scientist's hands (wearing blue nitrile gloves) carefully using a calibrated micropipette to transfer exactly 100μL of a clear blue liquid from a 50mL glass beaker into the third well of a 96-well microplate. The setting is a brightly lit, modern laboratory bench, slightly blurred (shallow depth of field) to focus attention sharply on the hands, pipette tip, and target well. Lighting is cool-toned and clinical from an overhead source. Show realistic reflections on the glassware and plastic microplate.](scientist_pipetting_microplate_photorealistic_macro.png)
    </Examples>
  </ImageGenerationGuideline>

</AIImageGenerationRules>
"""

    EXTRA_INSTRUCTIONS = ""
    if extra_instructions:
        EXTRA_INSTRUCTIONS = f"""
<ExtraInstructions>
{extra_instructions}
</ExtraInstructions>
"""

    # Build the system prompt
    prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        INSTRUCTIONS_CORE,
        LANGUAGE_INSTRUCTION,
        DESIRED_OUTPUT,
        CONSTRAINTS,
        PANDOC_PPTX_MARKDOWN_GUIDE,
        PRESENTATION_STYLE_GUIDE,
        OUTPUT_FORMAT,
        AI_IMAGE_GENERATION_RULES if ai_images else '',
        # Repetitions for emphasis
        INSTRUCTIONS_CORE,
        LANGUAGE_INSTRUCTION,
        THINKING_PROCESS,
        "</SystemPrompt>",
    ]

    SYSTEM_PROMPT = "\n\n".join(prompt_parts)

    writer = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL)  # Consider model selection based on complexity

    # Debug log for full system prompt (optional but helpful) and current writer messages
    # logger.info("\n\n------\nstart log\nidentifier debug write_presentation_markdown messages\nvalue:\n{}\n------\n\n".format(writer.messages))

    generation_prompt = f"""
<InputContent>
{content}
</InputContent>
{EXTRA_INSTRUCTIONS}
<FinalInstruction>
Generate the complete Pandoc Markdown presentation now, strictly adhering to all instructions, especially the detailed image prompt requirements if generating an image placeholder.
</FinalInstruction>
"""

    markdown_str: str = await writer.chat(generation_prompt)
    # ----------------- Post-generation validation -----------------
    try:
        _validate_single_title_only_slide(markdown_str)
    except ValueError as val_err:
        logger.warning(f"[write_presentation_markdown] Validation error: {val_err}. Attempting automatic fix.")
        markdown_str = await _fix_title_only_slides(markdown_str, str(val_err), max_retries=2)
        # Re-validate after attempted fixes; if it still fails, keep last version but log.
        try:
            _validate_single_title_only_slide(markdown_str)
        except ValueError as final_err:
            logger.error(f"[write_presentation_markdown] Unable to fix markdown after retries: {final_err}")

    return markdown_str.strip()  # Ensure no leading/trailing whitespace

async def create_image(prompt: str, size: Literal["square", "landscape", "portrait"] = "landscape", quality: Literal["low", "medium", "high", "auto"] = "high") -> str:
    llm = ALLM()
    b64 = await llm.create_image(prompt, size=size, quality=quality)
    img = Image.open(BytesIO(base64.b64decode(b64)))
    return img

async def improve_slides(markdown: str, max_retries: int = 2) -> str:
    """Validate Pandoc Markdown for a presentation and fix compile errors.

    The function tries to compile the *markdown* to PPTX using
    :func:`backend.utils.markdown_to_pptx_bytes`.  If compilation succeeds it
    immediately returns the original markdown.  When Pandoc raises an error
    (most commonly *exit-code 99* due to missing image resources) we call the
    LLM with a very focused prompt instructing it to **only** fix the specific
    issue(s) highlighted by Pandoc while preserving the overall content.

    The LLM **must not** add new content or slides – only remove or correct the
    problematic constructs (e.g. delete an image reference that points to a
    non-existent file).  The process is retried up to *max_retries* times or
    until Pandoc reports a successful conversion.
    """

    from backend.utils import markdown_to_pptx_bytes  # Local import to avoid circular deps

    func_name = "improve_slides"
    logger.info(f"[{func_name}] Validating markdown. Length={len(markdown)} chars.")

    async def _pandoc_compiles(md: str):
        """Attempt to compile *md* to PPTX in a worker thread."""
        loop = asyncio.get_running_loop()

        def _worker():
            try:
                # We only care about success/failure, no need to keep the bytes
                markdown_to_pptx_bytes(md)
                return True, ""
            except Exception as e:  # Pandoc or other errors
                return False, str(e)

        return await loop.run_in_executor(None, _worker)

    # Fast-path: if it already compiles we are done
    compiles, error_msg = await _pandoc_compiles(markdown)
    if compiles:
        logger.info(f"[{func_name}] Markdown compiles without changes. Returning original.")
        return markdown

    logger.warning(f"[{func_name}] Pandoc failed. Error: {error_msg[:200]}… – starting fix loop.")

    attempt = 0
    current_md = markdown
    current_error = error_msg

    while attempt < max_retries:
        attempt += 1
        logger.info(f"[{func_name}] Attempt {attempt}/{max_retries} – asking LLM to fix markdown.")

        ROLE_OBJECTIVE = """
<RoleAndObjective>
You are a world-class expert in Pandoc-compatible Markdown and PPTX conversion.
Your goal is to take a slide deck written in Pandoc Markdown that fails to
compile and make the **minimal changes** required so that it successfully
converts to PPTX **without changing the substantive content**.
</RoleAndObjective>
"""

        INSTRUCTIONS = """
<Instructions>
1. Read the <OriginalMarkdown> and the <PandocError> message.
2. Identify the syntactic element(s) that caused the failure.  The most common
   issue is an image reference pointing to a file that does not exist.
3. Apply the smallest possible fix:
   • If an image path is invalid, **remove the image reference** (and delete the
     entire slide only if it becomes empty).
   • If other minor syntax issues are detected, correct them.
4. Do NOT introduce new content, new slides, or new image placeholders.
5. Preserve headings, text, equations, code blocks, and slide order exactly as
   they are, except for elements removed to fix the compile error.
6. Return only the corrected Markdown. No commentary, no code fences.
</Instructions>
"""

        OUTPUT_FORMAT = """
<OutputFormat>Return *only* the raw Pandoc Markdown string.</OutputFormat>
"""

        SYSTEM_PROMPT = "\n\n".join([
            "<SystemPrompt>",
            ROLE_OBJECTIVE,
            INSTRUCTIONS,
            OUTPUT_FORMAT,
            "</SystemPrompt>",
        ])

        writer = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL)

        generation_prompt = f"""
<OriginalMarkdown>
{current_md}
</OriginalMarkdown>

<PandocError>
{current_error}
</PandocError>

<FinalInstruction>Provide the corrected Markdown now.</FinalInstruction>
"""

        try:
            fixed_md: str = await writer.chat(generation_prompt)
            fixed_md = fixed_md.strip()
        except Exception as llm_err:
            logger.error(f"[{func_name}] LLM call failed on attempt {attempt}: {llm_err}")
            break  # Cannot proceed without LLM

        compiles, error_msg = await _pandoc_compiles(fixed_md)
        if compiles:
            logger.info(f"[{func_name}] Markdown compiles after {attempt} attempt(s). Returning fixed version.")
            return fixed_md

        # Otherwise prepare next iteration
        current_md = fixed_md
        current_error = error_msg
        logger.warning(f"[{func_name}] Pandoc still failing after attempt {attempt}. Error: {error_msg[:200]}…")

    logger.error(f"[{func_name}] Unable to produce compilable markdown after {max_retries} attempts. Returning last version anyway.")
    return current_md  # Fall back to last attempt even if it still fails

# ----------------------
# Markdown Validation Helpers
# ----------------------

def _validate_single_title_only_slide(markdown: str) -> None:
    """Validate that the markdown presentation contains **at most one** title-only slide.

    A *title-only* slide is defined as a slide where, after trimming blank lines,
    there is exactly **one** line and that line is a Markdown heading (starts
    with one or more ``#`` followed by a space).

    Slides are delimited by a line that contains exactly ``---`` (surrounded by
    optional whitespace) as per Pandoc ``--slide-level=0`` conventions.

    Raises
    ------
    ValueError
        If more than one title-only slide is detected.
    """
    # Split the document into slides on lines that are solely '---'
    slides = re.split(r"^\s*---\s*$", markdown.strip(), flags=re.MULTILINE)

    title_only_count = 0
    for slide in slides:
        # Remove blank lines
        non_empty_lines = [ln.strip() for ln in slide.splitlines() if ln.strip()]
        if not non_empty_lines:
            # Empty slide → ignore
            continue
        if len(non_empty_lines) == 1 and re.match(r"^#{1,6}\s+.+", non_empty_lines[0]):
            title_only_count += 1

    if title_only_count > 1:
        raise ValueError(
            f"Presentation contains {title_only_count} title-only slides; only the first slide may be title-only."
        )

async def _fix_title_only_slides(markdown: str, error_message: str, max_retries: int = 2) -> str:
    """Attempt to automatically fix *markdown* that contains multiple title-only slides.

    The function uses the LLM to iteratively correct the problem by *either*
    converting excess title-only slides into full slides (adding text) or by
    merging/removing them, while preserving the overall structure and content
    as much as possible.
    """
    func_name = "fix_title_only_slides"

    attempt = 0
    current_md = markdown
    current_error = error_message

    while attempt < max_retries:
        attempt += 1
        logger.info(f"[{func_name}] Attempt {attempt}/{max_retries} – asking LLM to fix markdown.")

        ROLE_OBJECTIVE = """
<RoleAndObjective>
You are a world-class expert in Pandoc-compatible Markdown and academic slide
presentations. Your goal is to correct a Markdown slide deck so that **only the
very first slide** is title-only; every subsequent slide must contain content
beyond a single heading.
</RoleAndObjective>
"""

        INSTRUCTIONS = """
<Instructions>
1. Read <OriginalMarkdown> and the <ValidationError> message.
2. Identify slide(s) that consist solely of a heading (e.g. `# Something`) *after* the first slide.
3. For each offending slide, apply the **minimal fix**:
   • Prefer adding a short placeholder paragraph or bullet list elaborating on the heading.
   • If adding content is impossible, merge the heading into the previous slide or remove it.
4. Do **not** introduce new slides unrelated to the originals and do **not** delete substantive content.
5. Preserve slide ordering and existing content as much as possible.
6. Return only the corrected Markdown. No commentary, no code fences.
</Instructions>
"""

        OUTPUT_FORMAT = """
<OutputFormat>Return *only* the raw Pandoc Markdown string.</OutputFormat>
"""

        SYSTEM_PROMPT = "\n\n".join([
            "<SystemPrompt>",
            ROLE_OBJECTIVE,
            INSTRUCTIONS,
            OUTPUT_FORMAT,
            "</SystemPrompt>",
        ])

        writer = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL)

        generation_prompt = f"""
<OriginalMarkdown>
{current_md}
</OriginalMarkdown>

<ValidationError>
{current_error}
</ValidationError>

<FinalInstruction>Provide the corrected Markdown now.</FinalInstruction>
"""
        try:
            fixed_md: str = await writer.chat(generation_prompt)
            fixed_md = fixed_md.strip()
        except Exception as llm_err:
            logger.error(f"[{func_name}] LLM call failed on attempt {attempt}: {llm_err}")
            break  # Cannot proceed further

        try:
            _validate_single_title_only_slide(fixed_md)
            logger.info(f"[{func_name}] Validation passed after attempt {attempt}.")
            return fixed_md
        except ValueError as val_err:
            logger.warning(f"[{func_name}] Validation still failing after attempt {attempt}: {val_err}")
            current_md = fixed_md
            current_error = str(val_err)
            continue

    logger.error(f"[{func_name}] Unable to fix markdown after {max_retries} attempts. Returning last version anyway.")
    return current_md

#######################
# QUIZ GENERATION
#######################

async def create_quiz(content: str, language: str):
    """Generate a single-question quiz from *content*.

    The generated quiz must be answerable *only* with the given content. It
    returns a `Quiz` instance with one correct and three plausible but
    incorrect answers. Returns **None** if generation fails.
    """
    from backend.database import Quiz
    func_name = "create_quiz"
    logger.info(f"[{func_name}] Generating quiz. Content length: {len(content)} chars.")

    # --- Static Prompt Component Blocks ---
    ROLE_OBJECTIVE = """
<RoleAndObjective>
You are an expert educational content creator. Your task is to design a
single multiple-choice quiz question strictly based on the provided
<SectionContent>. The question **MUST** be answerable *only* using the
information contained in that section – no outside knowledge.
</RoleAndObjective>
"""

    INSTRUCTIONS_CORE = """
<Instructions>
    <General>
        1. **Read the Section:** Carefully analyse the `<SectionContent>`.
        2. **Draft Question:** Craft **one** clear question that tests
           comprehension of the key ideas in the section.
        3. **Generate Answers:** Provide exactly *four* answer options:
            a. One `correct_answer` that is unequivocally correct **and**
               directly derivable from the section. Ensure that the correct answer is not consistently the longest option; its length should be balanced with the incorrect answers.
            b. Three `incorrect_answer_*` options that are *plausible* given
               the context but ultimately wrong.
        4. **Plausibility Requirement:** Incorrect answers must sound
           believable yet must not be supported by the content.
        5. **Language Requirement:** Write the question, title and answers in
           the target language.
        6. **Adhere to Model:** Output must strictly follow the `Quiz`
           Pydantic model (see <OutputFormat>).
    </General>
</Instructions>
"""

    CONSTRAINTS = """
<Constraints>
    <Constraint name="NoExternalKnowledge">Do NOT introduce information that is not found in `<SectionContent>`.</Constraint>
    <Constraint name="ExactlyFourAnswers">Provide exactly one `correct_answer` and three `incorrect_answer_*` values.</Constraint>
    <Constraint name="AnswerUniqueness">Ensure none of the incorrect answers duplicate the correct answer or each other.</Constraint>
    <Constraint name="Language">All text (title, question, answers) must be in the target language specified.</Constraint>
</Constraints>
"""

    OUTPUT_FORMAT = """
<OutputFormat>
Output must strictly follow the `Quiz` Pydantic model structure
(`title`, `question`, `correct_answer`, `incorrect_answer_1`,
`incorrect_answer_2`, `incorrect_answer_3`).
</OutputFormat>
"""

    THINKING_PROCESS = """
<ThinkingProcess>
Think step-by-step:
1. Identify the most important concept(s) within the section.
2. Formulate a challenging yet fair question that targets those concept(s).
3. Draft one correct answer drawing explicitly from the section.
4. Devise three plausible distractors that could confuse learners but are
   not supported by the section.
5. Verify that the question can be answered using only the section content.
6. Assemble the final `Quiz` compliant output.
</ThinkingProcess>
"""

    # --- Compose System Prompt ---
    system_prompt_parts = [
        "<SystemPrompt>",
        ROLE_OBJECTIVE,
        INSTRUCTIONS_CORE,
        CONSTRAINTS,
        OUTPUT_FORMAT,
        THINKING_PROCESS,
        "</SystemPrompt>",
    ]
    SYSTEM_PROMPT = "\n".join(system_prompt_parts)

    # Instantiate LLM once
    llm = ALLM(system_prompt=SYSTEM_PROMPT, model=FAST_MODEL, client=shared_openai_client)

    # --- Dynamic Prompt Composition ---
    section_content_input = f"<SectionContent>\n{content}\n</SectionContent>"
    language_instruction_input = f"<TargetLanguage>{language.upper()}</TargetLanguage>"
    final_instruction_input = "<FinalInstruction>Generate the quiz now.</FinalInstruction>"

    generation_prompt = "\n".join([
        section_content_input,
        language_instruction_input,
        final_instruction_input,
    ])

    try:
        logger.debug(f"[{func_name}] Sending prompt to LLM (length: {len(generation_prompt)} chars).")
        quiz: Quiz = await llm.chat(generation_prompt, response_format=Quiz)
        logger.info(f"[{func_name}] Quiz generated successfully.")
        return quiz
    except Exception as e:
        logger.error(f"[{func_name}] Quiz generation failed: {e}")
        return None