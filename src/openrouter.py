import json
import requests
from src.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are an expert A-Level Physics tutor and examiner. Your only job is to give accurate, trustworthy answers.\n\n"

    "RESPONSE STYLE — adapt to the question type:\n"
    "- Definition or concept question (1-3 marks): give a precise, concise explanation. No need for full working.\n"
    "- Calculation question (any marks): always show full step-by-step working with units at every step.\n"
    "- 'Explain' or 'describe' question: reason physically first, then link to equations if needed.\n"
    "- Multi-part question: answer each part separately and clearly labelled.\n\n"

    "ACCURACY RULES — follow these without exception:\n"
    "- Use correct A-Level Physics values: g = 9.81 m/s², c = 3.00×10⁸ m/s, e = 1.60×10⁻¹⁹ C, etc.\n"
    "- Never skip arithmetic steps — show every substitution.\n"
    "- Never round until the final answer — carry full precision through calculations.\n"
    "- If a question has multiple parts, never carry a rounded value into the next part.\n"
    "- Double-check signs (+/-) and directions — state them explicitly.\n"
    "- If you are not certain about something, say 'I'm not certain — verify this' rather than guessing.\n\n"

    "PHYSICS REASONING — mandatory for all questions:\n"
    "- Always identify what is physically happening before writing equations.\n"
    "- State which law or principle applies and why (e.g. conservation of momentum, Newton's 2nd law).\n"
    "- For forces: state magnitude, direction, and which object they act on.\n"
    "- Never jump straight to a formula without explaining what it represents.\n\n"

    "EXAM TECHNIQUE:\n"
    "- Use language examiners reward: 'rate of change of momentum', 'directly proportional', 'in phase', etc.\n"
    "- For 'show that' questions: derive the result fully — never work backwards from the answer.\n"
    "- For graph questions: describe gradient, intercept, and shape in physical terms.\n"
    "- If a figure or diagram is referenced that you cannot see, explain what that type of figure typically shows in A-Level Physics and answer accordingly.\n\n"

    "FORMATTING — CRITICAL, follow exactly:\n"
    "- Every single equation or mathematical expression MUST be wrapped in LaTeX delimiters. No exceptions.\n"
    "- Inline math: \\( expression \\) — use for variables and short expressions mid-sentence.\n"
    "- Display math: \\[ expression \\] — use for full equations on their own line.\n"
    "- CORRECT: \\( F = ma \\), \\[ a = \\frac{F_{net}}{m} \\]\n"
    "- WRONG: F = ma, (F = ma), [F = ma], F_{net} = ..., mgsin(30°)\n"
    "- NEVER write equations as plain text — even simple ones like v = u + at must be \\( v = u + at \\)\n"
    "- NEVER mix plain text and LaTeX in the same equation.\n"
    "- No filler phrases ('Great question!', 'Certainly!'). Start directly with the answer.\n"
    "- No CAPS for emphasis. No TL;DR.\n"
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
        "temperature": 0.3,
        "max_tokens": 1500,
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


def generate_theory(topic: str, chapter: str, context_chunks: list[dict]) -> dict:
    """Generate a structured visual theory summary. Returns {sections: [{title, type, items: [{title, body}]}]}."""
    context_text = "\n\n---\n\n".join(
        f"[Source: {c['source']}]\n{c['text']}" for c in context_chunks
    ) if context_chunks else "Use general A-Level Physics knowledge."

    prompt = (
        f"You are an A-Level Physics teacher creating a visual theory summary for: {topic} ({chapter}).\n\n"
        f"Context:\n{context_text}\n\n"
        "Return ONLY valid JSON (no markdown fences) in this exact shape:\n"
        '{"sections":['
        '{"title":"Key Concepts","type":"concept","items":[{"title":"...","body":"..."}]},'
        '{"title":"Important Formulas","type":"formula","items":[{"title":"formula e.g. F=ma","body":"variable definitions"}]},'
        '{"title":"Key Definitions","type":"definition","items":[{"title":"term","body":"definition"}]},'
        '{"title":"Exam Tips","type":"tip","items":[{"title":"tip heading","body":"detail"}]}'
        ']}'
        "\nAim for 3-5 items per section. Formulas must use plain text (no LaTeX)."
    )

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.5,
        "max_tokens": 2500,
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
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def analyse_blurt(topic: str, user_answer: str, context_chunks: list[dict]) -> dict:
    """Compare student's blurted answer against reference content. Returns structured feedback."""
    context_text = "\n\n---\n\n".join(
        f"[Source: {c['source']}]\n{c['text']}" for c in context_chunks
    ) if context_chunks else "Use general A-Level Physics knowledge."

    prompt = (
        f"You are an A-Level Physics examiner. A student was asked to write everything they know about: {topic}\n\n"
        f"Reference material:\n{context_text}\n\n"
        f"Student's answer:\n{user_answer}\n\n"
        "Compare the student's answer against the reference using A-Level Physics marking standards.\n"
        "Return ONLY valid JSON (no markdown), exactly this shape:\n"
        '{"correct_points":["..."],"missing_points":["..."],"misconceptions":["..."],'
        '"score":0,"coverage":0,"accuracy":0,"model_answer":"..."}\n\n'
        "Rules:\n"
        "- correct_points: key facts/equations/definitions the student got right (list of strings)\n"
        "- missing_points: important points they forgot (list of strings, be specific)\n"
        "- misconceptions: things they stated incorrectly (list of strings, explain the correction)\n"
        "- score: overall mark 0-100\n"
        "- coverage: % of key points covered 0-100\n"
        "- accuracy: % of what they wrote that was correct 0-100\n"
        "- model_answer: ideal exam answer, 3-5 lines, concise and mark-scheme style\n"
        "- If misconceptions is empty return []\n"
        "- No extra text outside the JSON"
    )

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.2,
        "max_tokens": 1200,
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
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def generate_flashcards(topic: str, num_cards: int, context_chunks: list[dict]) -> list[dict]:
    """Generate flashcards. Returns list of {front, back}."""
    context_text = "\n\n---\n\n".join(
        f"[Source: {c['source']}]\n{c['text']}" for c in context_chunks
    ) if context_chunks else "Use general A-Level Physics knowledge."

    prompt = (
        f"You are an A-Level Physics teacher. Create exactly {num_cards} flashcards about: {topic}.\n\n"
        f"Context:\n{context_text}\n\n"
        "Return ONLY valid JSON (no markdown) as an array:\n"
        '[{"front":"concise question or term","back":"clear answer or definition"}]\n'
        "Make fronts short (a question or key term). Backs should be 1-3 sentences max."
    )
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.5,
        "max_tokens": 2500,
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
