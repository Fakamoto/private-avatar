"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCallback } from "react";

/** Mirrors the backend QuizModel fields we need on the client */
export interface Quiz {
  id?: number | null;
  title: string;
  question: string;
  correct_answer: string;
  incorrect_answer_1: string;
  incorrect_answer_2: string;
  incorrect_answer_3: string;
  user_answer?: string | null;
}

/** Local UI state passed down from parent so it persists on re-render */
export interface QuizAttemptState {
  answered: boolean;
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  shuffledAnswers: string[];
  originalCorrectAnswer: string;
}

interface QuizComponentProps {
  quiz: Quiz;
  state: QuizAttemptState;
  /** Callback to update parent – receives the answer chosen & correctness */
  onAnswer: (selected: string, isCorrect: boolean) => void;
}

export function QuizComponent({ quiz, state, onAnswer }: QuizComponentProps) {
  const handleClick = useCallback(
    (option: string) => {
      if (state.answered) return; // already answered
      const isCorrect = option === state.originalCorrectAnswer;
      onAnswer(option, isCorrect);
    },
    [state, onAnswer]
  );

  return (
    <Card className="mt-6 border-2 border-purple-200 bg-gradient-to-br from-purple-50/40 to-indigo-50/40 shadow-lg transition-all hover:shadow-xl">
      <CardHeader className="border-b border-purple-100 bg-white/50 pb-4">
        <CardTitle className="flex items-center justify-center gap-3 text-xl font-semibold text-purple-700">
          <span role="img" aria-label="quiz" className="text-2xl">🎯</span>
          <span className="mx-1">{quiz.title}</span>
          <span role="img" aria-label="brain" className="text-2xl">🧠</span>
          <span role="img" aria-label="sparkles" className="text-2xl">✨</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <p className="mb-6 text-lg font-medium text-gray-800">{quiz.question}</p>

        <div className="grid grid-cols-1 gap-3">
          {state.shuffledAnswers.map((option) => {
            /* ---------- colour logic ---------- */
            const base =
              "cursor-pointer rounded-md border p-4 text-base transition-all duration-200 select-none";
            let classes = base;

            if (state.answered) {
              if (option === state.selectedAnswer) {
                classes += state.isCorrect
                  ? " border-green-500 bg-green-500 text-white ring-2 ring-green-500 ring-offset-2"
                  : " border-red-500 bg-red-500 text-white ring-2 ring-red-500 ring-offset-2";
              } else if (!state.isCorrect && option === state.originalCorrectAnswer) {
                classes += " border-green-500 bg-green-500 text-white ring-2 ring-green-500 ring-offset-2";
              } else {
                classes += " bg-gray-100 text-gray-500";
              }
            } else {
              classes += " border-purple-100 bg-white hover:border-purple-300 hover:bg-purple-50 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]";
            }

            return (
              <div
                key={option}
                className={cn(classes)}
                onClick={() => handleClick(option)}
              >
                {option}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default QuizComponent; 