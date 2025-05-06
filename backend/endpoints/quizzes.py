from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import Quiz, get_session

router = APIRouter()


class QuizAnswerPayload(BaseModel):
    answer: str


@router.post("/quizzes/{quiz_id}/answer", response_model=Quiz)
def submit_quiz_answer(
    *,
    session: Annotated[Session, Depends(get_session)],
    quiz_id: int,
    payload: QuizAnswerPayload,
):
    """Submit an answer for a quiz and store it."""
    quiz = session.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    quiz.user_answer = payload.answer
    session.add(quiz)
    session.commit()
    session.refresh(quiz)
    return quiz 