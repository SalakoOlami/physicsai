import json
import requests
from src.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are a brilliant A-Level Physics tutor and a friendly study companion. "
    "You're like a super-smart friend who gets physics AND knows how to have a normal conversation.\n\n"
    "When given context passages, answer using them. When there are no context passages, respond naturally.\n\n"
    "How to answer:\n"
    "- Be natural and conversational — like texting a smart friend, not reading a textbook\n"
    "- Get straight to the point. No filler like 'Great question!' or 'Certainly!'\n"
    "- Use plain English a 16-18 year old would understand\n"
    "- Only use bullet points if the concept genuinely needs them\n"
    "- Only draw an ASCII diagram if words truly cannot explain it\n"
    "- Do NOT write key terms in CAPS\n"
    "- Do NOT end with TL;DR\n"
    "- If context passages are garbled, silently skip them\n"
    "- If someone goes off-topic or just wants to chat, be friendly and engage naturally\n"
    "- If asked something totally outside physics, you can answer briefly and steer back to studying"
)

CHAT_PROMPT = (
    "You are a friendly A-Level Physics tutor and study companion. "
    "The student is chatting casually — respond naturally and warmly like a smart friend. "
    "Keep it short and conversational. If it's a casual question, answer it. "
    "If they seem to want to study, encourage them. Don't be stiff or robotic."
)


def _build_user_message(query: str, context_chunks: list[dict]) -> str:
    context_text = "\n\n---\n\n".join(
        f"[Source: {c['source']}"
        + (f", Page {c['page_number']}" if c.get("page_number") else "")
        + f"]\n{c['text']}"
        for c in context_chunks
    )
    return f"Context:\n{context_text}\n\nQuestion: {query}"


_LANG_INSTRUCTIONS = {
    "zh": "Respond entirely in Simplified Chinese (中文).",
    "ko": "Respond entirely in Korean (한국어).",
    "en": "",
}


def yield_answer(query: str, context_chunks: list[dict], language: str = "en"):
    """Generator that yields text chunks for SSE streaming (web API path)."""
    lang_note = _LANG_INSTRUCTIONS.get(language, "")
    system = SYSTEM_PROMPT + (f"\n\nIMPORTANT: {lang_note}" if lang_note else "")
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _build_user_message(query, context_chunks)},
        ],
        "stream": True,
        "temperature": 0.5,
        "max_tokens": 800,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "RAG System",
    }

    with requests.post(
        OPENROUTER_URL,
        json=payload,
        headers=headers,
        stream=True,
        timeout=120,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            line = line.decode("utf-8")
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                delta = chunk["choices"][0]["delta"].get("content", "")
                if delta:
                    yield delta
            except (json.JSONDecodeError, KeyError, IndexError):
                continue


def stream_answer(query: str, context_chunks: list[dict]) -> None:
    """Stream the LLM answer to stdout using the OpenRouter chat completions API."""
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(query, context_chunks)},
        ],
        "stream": True,
        "temperature": 0.5,
        "max_tokens": 800,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "RAG System",
    }

    with requests.post(
        OPENROUTER_URL,
        json=payload,
        headers=headers,
        stream=True,
        timeout=120,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            line = line.decode("utf-8")
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                delta = chunk["choices"][0]["delta"].get("content", "")
                if delta:
                    print(delta, end="", flush=True)
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
    print()


_DIFFICULTY_GUIDE = {
    "easy":   "straightforward recall — definitions, simple calculations, basic concepts",
    "medium": "application — multi-step problems, explain phenomena, interpret graphs",
    "hard":   "challenging exam-style — complex calculations, synoptic links, evaluate experiments",
}


def generate_quiz(topic: str, difficulty: str, num_questions: int, context_chunks: list[dict], language: str = "en") -> list[dict]:
    """Generate MCQ quiz questions using the LLM. Returns list of {question, options, answer, explanation}."""
    lang_note = _LANG_INSTRUCTIONS.get(language, "")
    diff_guide = _DIFFICULTY_GUIDE.get(difficulty, _DIFFICULTY_GUIDE["medium"])

    context_text = "\n\n---\n\n".join(
        f"[Source: {c['source']}]\n{c['text']}" for c in context_chunks
    ) if context_chunks else "Use general A-Level Physics knowledge."

    lang_instruction = (
        f"\nWrite all question text, options, and explanations in {lang_note.replace('Respond entirely in ', '').replace('.', '')}."
        if lang_note else ""
    )

    prompt = (
        f"You are an A-Level Physics examiner. Generate exactly {num_questions} multiple-choice questions about: {topic}.\n"
        f"Difficulty: {difficulty} — {diff_guide}\n\n"
        f"Context:\n{context_text}\n\n"
        "Return ONLY a valid JSON array, no markdown, no extra text:\n"
        '[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","explanation":"..."}]'
        + lang_instruction
    )

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.6,
        "max_tokens": 3000,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "RAG System",
    }

    resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"].strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def yield_chat(message: str, language: str = "en"):
    """Conversational fallback — no context, just a friendly chat response."""
    lang_note = _LANG_INSTRUCTIONS.get(language, "")
    system = CHAT_PROMPT + (f" {lang_note}" if lang_note else "")
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": message},
        ],
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 300,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "RAG System",
    }
    with requests.post(OPENROUTER_URL, json=payload, headers=headers, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            line = line.decode("utf-8")
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                delta = chunk["choices"][0]["delta"].get("content", "")
                if delta:
                    yield delta
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
