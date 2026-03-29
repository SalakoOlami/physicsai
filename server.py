"""
server.py — FastAPI backend for the A-Level Physics AI Tutor web app.

Run with:
    uvicorn server:app --reload
"""
import json
from collections import defaultdict
from typing import AsyncGenerator

import src.config as _config  # triggers dotenv load
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.embedder import embed_query
from src.openrouter import yield_answer, yield_chat, generate_quiz
from src.pinecone_store import get_client, query_index


def _is_readable(text: str) -> bool:
    """Return True if the chunk contains mostly readable text."""
    if not text or len(text) < 20:
        return False
    alphanum = sum(c.isalnum() or c.isspace() for c in text)
    return (alphanum / len(text)) >= 0.6

app = FastAPI(title="Physics RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://tiny-wisp-c3d4e3.netlify.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialise Pinecone client once at startup
_pc = get_client()

_GREETINGS = {"hi", "hii", "hello", "hey", "heyy", "heyyy", "yo", "sup", "hola", "howdy", "what's up", "whats up"}

def _is_greeting(text: str) -> bool:
    return text.strip().lower().rstrip("!?.") in _GREETINGS


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    top_k: int = Field(5, ge=1, le=20)
    language: str = Field("en", pattern=r"^[a-z]{2}$")


class QuizRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    difficulty: str = Field("medium", pattern=r"^(easy|medium|hard)$")
    num_questions: int = Field(5, ge=1, le=20)
    language: str = Field("en", pattern=r"^[a-z]{2}$")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/query")
def query(req: QueryRequest):
    """
    SSE streaming endpoint.

    Events sent:
      data: {"type": "chunk",   "content": "..."}
      data: {"type": "sources", "sources": [...]}
      data: {"type": "done"}
    """
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")

    def event_stream() -> AsyncGenerator:
        # Signal that we're thinking (shows spinner immediately)
        yield f"data: {json.dumps({'type': 'thinking'})}\n\n"

        # Handle greetings/casual chat directly — skip Pinecone
        if _is_greeting(req.question):
            for delta in yield_chat(req.question, req.language):
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # 1. Embed the query
        try:
            q_vec = embed_query(req.question)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # 2. Retrieve from Pinecone
        try:
            matches = query_index(_pc, q_vec, req.top_k)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # Filter out garbled/unreadable chunks
        matches = [m for m in matches if _is_readable(m.get("text", ""))]
        if not matches:
            # No good context — fall back to conversational response
            for delta in yield_chat(req.question, req.language):
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # 3. Stream answer chunks
        try:
            for delta in yield_answer(req.question, matches, req.language):
                payload = json.dumps({"type": "chunk", "content": delta})
                yield f"data: {payload}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # 4. Send sources
        sources_payload = json.dumps({"type": "sources", "sources": matches})
        yield f"data: {sources_payload}\n\n"

        # 5. Done
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/sources")
def list_sources():
    """
    Return a list of unique source documents stored in Pinecone.
    Groups chunks by source filename and returns metadata.
    """
    try:
        index = _pc.Index(_config.PINECONE_INDEX_NAME)
        # Use a dummy zero vector to fetch a broad sample of vectors
        zero_vec = [0.0] * _config.EMBEDDING_DIMENSION
        result = index.query(
            vector=zero_vec,
            top_k=10000,
            include_metadata=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Group by source
    grouped: dict[str, dict] = defaultdict(lambda: {"modality": "unknown", "pages": set()})
    for match in result.get("matches", []):
        meta = match.get("metadata", {})
        src = meta.get("source", "unknown")
        grouped[src]["modality"] = meta.get("modality", "unknown")
        page = meta.get("page_number")
        if page is not None:
            grouped[src]["pages"].add(page)

    sources = [
        {
            "source": src,
            "modality": info["modality"],
            "page_count": len(info["pages"]) or 1,
        }
        for src, info in sorted(grouped.items())
    ]
    return {"sources": sources}


@app.post("/api/quiz")
def quiz(req: QuizRequest):
    """Generate a set of MCQ questions for the requested topic and difficulty."""
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic must not be empty")
    if req.num_questions < 1 or req.num_questions > 20:
        raise HTTPException(status_code=400, detail="num_questions must be 1–20")

    # Retrieve relevant context for the topic
    try:
        q_vec = embed_query(req.topic)
        matches = query_index(_pc, q_vec, top_k=8)
        matches = [m for m in matches if _is_readable(m.get("text", ""))]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrieval error: {e}")

    try:
        questions = generate_quiz(req.topic, req.difficulty, req.num_questions, matches, req.language)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quiz generation error: {e}")

    return {"questions": questions}
