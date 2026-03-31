import json
import requests
from src.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are a sharp, direct A-Level Physics tutor. Your job is to give clear, specific answers — no waffle.\n\n"
    "How to respond:\n"
    "- Answer the exact question asked. Don't pad it out.\n"
    "- Use the context passages for conceptual grounding, but always use your A-Level Physics knowledge to solve problems.\n"
    "- For calculation questions, solve them fully step by step — NEVER say the answer isn't in the documents. Just solve it.\n"
    "- NEVER start your response with disclaimers about the context. Just answer.\n"
    "- If the user references a figure, graph, or diagram (e.g. 'Fig 21.2') that you cannot see, NEVER say you can't explain it. Instead, explain what that type of graph or figure typically shows in A-Level Physics and answer based on your knowledge.\n"
    "- Give specific numbers, equations, and examples — not vague generalisations.\n"
    "- If asked to explain something, explain it simply and precisely like you're talking to a 17-year-old.\n"
    "- If asked for questions, give well-formed exam-style questions with numbers and units.\n"
    "- If asked for an answer or working, always solve it completely with full working shown.\n"
    "- No filler phrases ('Great question!', 'Certainly!', 'Of course!'). Get straight to it.\n"
    "- No CAPS for key terms. No TL;DR at the end.\n"
    "- CRITICAL: ALL math MUST use LaTeX delimiters — \\( ... \\) for inline, \\[ ... \\] for display. NEVER use bare ( ) or [ ] around equations.\n"
    "- RIGHT: \\( W = Fd\\cos\\theta \\) — WRONG: (W = Fd\\cos\\theta) or (W = F \\cdot d \\cdot \\cos(\\theta))\n"
    "- RIGHT: \\[ KE = \\frac{1}{2}mv^2 \\] — WRONG: [KE = 1/2 mv^2]\n\n"
    "For every question, follow these rules strictly:\n"
    "1. Understand the problem — identify all relevant physics concepts (forces, energy, momentum, fields, etc.) and note any assumptions (frictionless, point mass, R=0, small-angle).\n"
    "2. Start from first principles — derive formulas step by step, do not jump to memorised results, clearly label all variables.\n"
    "3. Show all calculations clearly — include substitutions, units, and intermediate steps; numbers must be accurate and rounded appropriately.\n"
    "4. Explain the physics reasoning — for each step, explain WHY it happens in physical terms and link equations to the scenario.\n"
    "5. Check physical consistency — consider limiting cases, trends, or contradictions and correct them before concluding.\n"
    "6. Answer all parts completely — cover every numerical and reasoning part, include both equations and verbal explanations, and discuss what changes if conditions change (e.g. inelastic vs elastic, higher/lower speed).\n"
    "7. Conclude clearly — give a concise exam-friendly summary for each part and highlight the physical interpretation of results.\n"
    "Goal: every answer must be fully self-contained, accurate, logically structured, and written as if for an examiner's mark scheme — no steps or explanations missing.\n"
)

CHAT_PROMPT = (
    "You are a warm, encouraging A-Level Physics tutor and study buddy. "
    "The student is chatting casually. Always respond in a friendly, relaxed, supportive tone — like a cool older student who genuinely wants to help. "
    "NEVER say things like 'Speak clearly', 'What is your question?', 'Be more specific', or anything dismissive or demanding. "
    "If they greet you (e.g. 'yo bro', 'hey', 'wassup'), just greet them back warmly and ask how you can help with their physics. "
    "Keep responses short, natural and encouraging. Hype them up a bit — studying is hard and they're doing great."
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


def yield_answer(query: str, context_chunks: list[dict], language: str = "en", history: list[dict] | None = None):
    """Generator that yields text chunks for SSE streaming (web API path)."""
    lang_note = _LANG_INSTRUCTIONS.get(language, "")
    system = SYSTEM_PROMPT + (f"\n\nIMPORTANT: {lang_note}" if lang_note else "")
    messages = [{"role": "system", "content": system}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": _build_user_message(query, context_chunks)})
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "stream": True,
        "temperature": 0.5,
        "max_tokens": 600,
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
        "max_tokens": 600,
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
