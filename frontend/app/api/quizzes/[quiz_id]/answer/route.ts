import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { quiz_id: string } }
) {
  const { quiz_id } = params;
  const body = await request.json();

  if (!quiz_id) {
    return NextResponse.json({ error: 'Quiz ID is required' }, { status: 400 });
  }

  const backendUrl = process.env.API_BASE_URL || 'http://localhost:8000';

  try {
    const response = await fetch(`${backendUrl}/quizzes/${quiz_id}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Backend error: ${response.status}`, errorData);
      return NextResponse.json({ error: `Error from backend: ${errorData}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying to backend:', error);
    return NextResponse.json({ error: 'Failed to submit quiz answer' }, { status: 500 });
  }
} 