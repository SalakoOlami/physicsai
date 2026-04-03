"""
server.py — FastAPI backend for the A-Level Physics AI Tutor web app.

Run with:
    uvicorn server:app --reload
"""
import json
import random
import sqlite3
import string
import time
from collections import defaultdict
from datetime import datetime
from typing import AsyncGenerator

import src.config as _config  # triggers dotenv load
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.embedder import embed_query
from src.openrouter import yield_answer, yield_chat, generate_quiz, generate_theory
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
    allow_origins=["https://tiny-wisp-c3d4e3.netlify.app", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth DB — SQLite
# ---------------------------------------------------------------------------
_DB_PATH = "users.db"

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS access_codes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            email        TEXT NOT NULL UNIQUE,
            code         TEXT NOT NULL UNIQUE,
            status       TEXT NOT NULL DEFAULT 'PENDING',
            created_at   TEXT NOT NULL,
            activated_at TEXT,
            expires_at   TEXT
        )
    """)
    # Add expires_at column if upgrading from older schema
    try:
        conn.execute("ALTER TABLE access_codes ADD COLUMN expires_at TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    conn.commit()
    conn.close()

def _init_usage_db():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_usage (
            ip   TEXT NOT NULL,
            date TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (ip, date)
        )
    """)
    conn.commit()
    conn.close()

_init_db()
_init_usage_db()

# ---------------------------------------------------------------------------
# Rate limiting & daily limits
# ---------------------------------------------------------------------------
_RATE_STORE: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW  = 60   # seconds
_RATE_MAX     = 20   # requests per window per IP
_DAILY_MAX    = 100  # requests per day per IP

def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _check_rate_limit(ip: str):
    now = time.time()
    cutoff = now - _RATE_WINDOW
    _RATE_STORE[ip] = [t for t in _RATE_STORE[ip] if t > cutoff]
    if len(_RATE_STORE[ip]) >= _RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many requests — slow down and try again in a minute.")
    _RATE_STORE[ip].append(now)

def _check_daily_limit(ip: str):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT count FROM daily_usage WHERE ip = ? AND date = ?", (ip, today)
        ).fetchone()
        count = row["count"] if row else 0
        if count >= _DAILY_MAX:
            raise HTTPException(status_code=429, detail="Daily limit reached. Come back tomorrow!")
        if row:
            conn.execute(
                "UPDATE daily_usage SET count = count + 1 WHERE ip = ? AND date = ?", (ip, today)
            )
        else:
            conn.execute(
                "INSERT INTO daily_usage (ip, date, count) VALUES (?, ?, 1)", (ip, today)
            )
        conn.commit()
    finally:
        conn.close()

def _throttle(request: Request):
    ip = _get_ip(request)
    _check_rate_limit(ip)
    _check_daily_limit(ip)

def _generate_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        candidate = ''.join(random.choices(alphabet, k=8))
        conn = _get_db()
        row = conn.execute("SELECT id FROM access_codes WHERE code = ?", (candidate,)).fetchone()
        conn.close()
        if not row:
            return candidate

from fastapi.staticfiles import StaticFiles
from pathlib import Path as _Path

_PAPERS_DIR = _Path("./papers")
_PAPERS_DIR.mkdir(exist_ok=True)
app.mount("/papers", StaticFiles(directory=_PAPERS_DIR), name="papers")

# Initialise Pinecone client once at startup
_pc = get_client()

# Simple in-memory embedding cache (survives for the lifetime of the process)
_embed_cache: dict[str, list[float]] = {}

# Cache for library sources — avoids querying Pinecone top_k=10000 on every page visit
_sources_cache: list[dict] | None = None

# Load Drive resource map (filename → preview URL) generated by scan_drive.py
_DRIVE_MAP_PATH = _Path("drive_resources.json")
_drive_map: dict[str, str] = {}
try:
    if _DRIVE_MAP_PATH.exists():
        _drive_map = json.loads(_DRIVE_MAP_PATH.read_text(encoding="utf-8"))
except Exception:
    pass

def _cached_embed(question: str) -> list[float]:
    key = question.strip().lower()
    if key not in _embed_cache:
        _embed_cache[key] = embed_query(question)
        if len(_embed_cache) > 500:          # cap memory usage
            _embed_cache.pop(next(iter(_embed_cache)))
    return _embed_cache[key]

_GREETING_STARTERS = {"hi", "hey", "hello", "yo", "sup", "bro", "wassup", "wsg", "hola",
                      "howdy", "morning", "evening", "afternoon", "heyy", "heyyy", "hii"}

def _is_greeting(text: str) -> bool:
    cleaned = text.strip().lower().rstrip("!?.")
    words = cleaned.split()
    # Short casual message (≤6 words) that starts with or is a greeting word
    if not words:
        return False
    return len(words) <= 6 and words[0] in _GREETING_STARTERS


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    top_k: int = Field(3, ge=1, le=20)
    language: str = Field("en", pattern=r"^[a-z]{2}$")
    history: list[ChatMessage] = Field(default_factory=list)


class QuizRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    difficulty: str = Field("medium", pattern=r"^(easy|medium|hard)$")
    num_questions: int = Field(5, ge=1, le=20)
    language: str = Field("en", pattern=r"^[a-z]{2}$")


class TheoryRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    chapter: str = Field("", max_length=200)


class RegisterRequest(BaseModel):
    name:  str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=200)

class LoginRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=8)

class AdminActivateRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=8)
    key:  str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def warmup():
    """Pre-warm the Gemini embedding connection so the first user query isn't slow."""
    try:
        _cached_embed("warmup")
    except Exception:
        pass  # Don't crash startup if warmup fails

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    name  = req.name.strip()
    email = req.email.strip().lower()
    conn  = _get_db()
    try:
        existing = conn.execute(
            "SELECT code, status FROM access_codes WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            if existing["status"] == "ACTIVE":
                return {"message": "already_active"}
            return {"message": "already_registered"}
        code = _generate_code()
        now  = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO access_codes (name, email, code, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)",
            (name, email, code, now)
        )
        conn.commit()
        return {"message": "registered", "code": code}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Email already registered")
    finally:
        conn.close()


@app.post("/api/auth/login")
def login(req: LoginRequest):
    code = req.code.strip().upper()
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT name, email, status, expires_at FROM access_codes WHERE code = ?", (code,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid code")
        if row["status"] != "ACTIVE":
            raise HTTPException(status_code=403, detail="Code not yet activated")
        if row["expires_at"] and datetime.utcnow().isoformat() > row["expires_at"]:
            raise HTTPException(status_code=403, detail="Subscription expired")
        return {"token": code, "name": row["name"], "email": row["email"], "expires_at": row["expires_at"]}
    finally:
        conn.close()


@app.get("/api/admin/users")
def admin_list_users(key: str):
    if key != _config.ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT name, email, code, status, created_at, activated_at, expires_at "
            "FROM access_codes ORDER BY created_at DESC"
        ).fetchall()
        return {"users": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.post("/api/admin/activate")
def admin_activate(req: AdminActivateRequest):
    if req.key != _config.ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    code = req.code.strip().upper()
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT id, status FROM access_codes WHERE code = ?", (code,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Code not found")
        if row["status"] == "ACTIVE":
            return {"message": "already_active"}
        from datetime import timedelta
        now        = datetime.utcnow().isoformat()
        expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
        conn.execute(
            "UPDATE access_codes SET status='ACTIVE', activated_at=?, expires_at=? WHERE code=?",
            (now, expires_at, code)
        )
        conn.commit()
        return {"message": "activated", "code": code, "expires_at": expires_at}
    finally:
        conn.close()


@app.post("/api/query")
def query(req: QueryRequest, request: Request):
    _throttle(request)
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

        # 1. Build search query — enrich vague follow-ups with the best topic from history
        _VAGUE = {"this", "it", "that", "these", "those", "same", "more", "answer",
                  "question", "questions", "solution", "working", "steps", "hint", "help",
                  "example", "examples", "elaborate", "further", "continue", "again", "another"}
        _FILLER = {"can", "u", "you", "give", "me", "more", "be", "explanable", "explain", "tell", "about",
                   "a", "an", "the", "is", "what", "how", "why", "ok", "okay", "sure", "yes", "no", "and"}
        words = set(req.question.lower().split())
        is_vague = len(req.question.split()) <= 12 and bool(words & _VAGUE)
        if is_vague and req.history:
            # Find the most substantive user message (longest, not a filler phrase)
            user_msgs = [m.content for m in req.history if m.role == "user"]
            topic_msg = max(user_msgs, key=lambda m: len(set(m.lower().split()) - _FILLER), default=None)
            search_query = f"{topic_msg} {req.question}" if topic_msg else req.question
        else:
            search_query = req.question

        # Embed the query (cached)
        try:
            q_vec = _cached_embed(search_query)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # 2. Retrieve from Pinecone
        try:
            matches = query_index(_pc, q_vec, req.top_k)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # Filter out garbled/unreadable chunks and low-relevance results
        matches = [m for m in matches if _is_readable(m.get("text", ""))]
        if not matches:
            # No readable context — fall back to LLM general knowledge
            for delta in yield_chat(req.question, req.language):
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # 3. Stream answer chunks
        try:
            history = [{"role": m.role, "content": m.content} for m in req.history[-6:]]
            for delta in yield_answer(req.question, matches, req.language, history):
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
    global _sources_cache
    if _sources_cache is not None:
        return {"sources": _sources_cache}

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
            "url": _drive_map.get(src),
        }
        for src, info in sorted(grouped.items())
    ]
    _sources_cache = sources
    return {"sources": sources}


@app.post("/api/quiz")
def quiz(req: QuizRequest, request: Request):
    """Generate a set of MCQ questions for the requested topic and difficulty."""
    _throttle(request)
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


@app.post("/api/theory")
def theory(req: TheoryRequest, request: Request):
    """Generate a structured visual theory summary for the requested topic."""
    _throttle(request)
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic must not be empty")
    try:
        q_vec = embed_query(req.topic)
        matches = query_index(_pc, q_vec, top_k=8)
        matches = [m for m in matches if _is_readable(m.get("text", ""))]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrieval error: {e}")
    try:
        result = generate_theory(req.topic, req.chapter, matches)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Theory generation error: {e}")
    return result


def _gdrive_preview(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{file_id}/preview"

def _extract_id(url: str) -> str:
    return url.split("/d/")[1].split("/")[0]

_GDRIVE_PAPERS = [
    {
        "name": "2018 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1_wkxWixUrwFJXgaTksFx3sTXcqP2e-uE/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1UvupOzXARf2ZN1S75WAwG2po4mZ9vcpy/view")),
    },
    {
        "name": "2019 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1Uu_u2kTqY8H3hoO4mZCsm-rKxoYq8B33/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1AhQW81K61Q6XguQrKdmwykYGcCAy7TDO/view")),
    },
    {
        "name": "2020 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1IBTarByuPdhQu8PToDIyrZNOryPSYZpZ/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1pl3C3TIA6ypy2wKOhOjUVp6IOY12xt8j/view")),
    },
    {
        "name": "2021 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/15SMbGaz4eq40aTXbpHt2KLc4PQcoPtK2/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1l7q-6Im7Y_cjuaCGrP82ZSfeP8eeXOFT/view")),
    },
    {
        "name": "2022 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1SE860PhZEETnRYn1laLkkkR5wS2sFGAr/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1TXh1DbawL7Svel7s7sZU4JlmkFCo6H9B/view")),
    },
    {
        "name": "2023 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/12UfI7i5clKqI7Bn9g0P93fBK3zbACwNn/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1yKiIYHIV7OwAtXCslQfJvsfP_1MAYkqx/view")),
    },
    {
        "name": "2024 — Breadth In Physics",
        "questions_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1aSnms7-leYjh9MtNcOqrxwJWsBMTx0am/view")),
        "markscheme_url": _gdrive_preview(_extract_id("https://drive.google.com/file/d/1qgNkHOjEmfRVjX-BO8DMmDstNeTEsMQl/view")),
    },
]

@app.get("/api/papers")
def list_papers():
    """Return paired question + mark scheme PDFs hosted on Google Drive."""
    results = _GDRIVE_PAPERS

    return {"papers": sorted(results, key=lambda x: x["name"])}


_GDRIVE_TAS = [
    {
        "id": "TA03",
        "name": "TA 03 — Forces and Motion",
        "chapter": "Chapter 4",
        "topic": "Forces and Motion",
        "pdf_url": _drive_map.get("Chapter_4_2025_Q&A.pdf", ""),
    },
    {
        "id": "TA04",
        "name": "TA 04 — Work, Energy and Power",
        "chapter": "Chapter 5",
        "topic": "Work, Energy and Power",
        "pdf_url": _drive_map.get("Ch5-Work_Energy_and_Power_2025_Q&A.pdf", ""),
    },
    {
        "id": "TA05",
        "name": "TA 05 — Materials",
        "chapter": "Chapter 6",
        "topic": "Materials, stress, strain and Young modulus",
        "pdf_url": _drive_map.get("PHBx_Chapter_6_TA_2025_Q&A.pdf", ""),
    },
    {
        "id": "TA06",
        "name": "TA 06 — Laws of Motion and Momentum",
        "chapter": "Chapter 7",
        "topic": "Laws of Motion and Momentum",
        "pdf_url": _drive_map.get("Chapter_7_TA_2025_Q&A.pdf", ""),
    },
    {
        "id": "TA07",
        "name": "TA 07 — Breadth Review (Chapters 1–7)",
        "chapter": "Chapters 1–7",
        "topic": "Breadth Review Chapters 1 to 7",
        "pdf_url": _drive_map.get("Ch.1-7_Revision TA_2026_Q&A.pdf", ""),
    },
    {
        "id": "TA08",
        "name": "TA 08 — Electricity and Resistance",
        "chapter": "Chapter 9",
        "topic": "Electricity, resistance and I-V characteristics",
        "pdf_url": _drive_map.get("Chapter_9_TA_2026_Q&A.pdf", ""),
    },
    {
        "id": "TA09",
        "name": "TA 09 — Charge, Circuits and Nuclear",
        "chapter": "Chapters 8–10",
        "topic": "Charge, electric circuits and nuclear physics",
        "pdf_url": _drive_map.get("PHBx_Chapters_8-10_2026_Q&A.pdf", ""),
    },
    {
        "id": "TA10",
        "name": "TA 10 — Nuclear and Particle Physics",
        "chapter": "Chapter 10",
        "topic": "Nuclear and particle physics",
        "pdf_url": _drive_map.get("Chapter_10_TA_2026_Q&A.pdf", ""),
    },
    {
        "id": "TA11",
        "name": "TA 11 — Waves and Optics",
        "chapter": "Chapter 11",
        "topic": "Waves, refraction and optical phenomena",
        "pdf_url": _drive_map.get("Chapter_11_2026_Q&A.pdf", ""),
    },
]


@app.get("/api/tas")
def list_tas():
    """Return TA papers with chapter info and Drive PDF URLs."""
    return {"tas": _GDRIVE_TAS}
