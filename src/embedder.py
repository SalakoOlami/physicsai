import time
import google.generativeai as genai
import google.api_core.exceptions
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from src.config import GEMINI_API_KEY, EMBEDDING_MODEL

genai.configure(api_key=GEMINI_API_KEY)

_vision_model = genai.GenerativeModel("gemini-2.0-flash")

# Free tier: ~15 RPM → 1 request every 4 seconds minimum
_EMBED_DELAY_SECONDS = 4.0


@retry(
    retry=retry_if_exception_type((
        google.api_core.exceptions.ResourceExhausted,
        google.api_core.exceptions.ServiceUnavailable,
        google.api_core.exceptions.DeadlineExceeded,
    )),
    wait=wait_exponential(multiplier=2, min=15, max=120),
    stop=stop_after_attempt(8),
    reraise=True,
)
def _embed_single(text: str, task_type: str) -> list[float]:
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=text,
        task_type=task_type,
        # output_dimensionality omitted → returns full 3072 dims
    )
    return result["embedding"]


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a list of document chunks (ingest path). Uses RETRIEVAL_DOCUMENT task type."""
    embeddings = []
    for i, t in enumerate(texts):
        embeddings.append(_embed_single(t, "RETRIEVAL_DOCUMENT"))
        if i < len(texts) - 1:
            time.sleep(_EMBED_DELAY_SECONDS)
    return embeddings


def embed_query(text: str) -> list[float]:
    """Embed a single query string (query path). Uses RETRIEVAL_QUERY task type."""
    return _embed_single(text, "RETRIEVAL_QUERY")


def embed_image(image_bytes: bytes, mime_type: str) -> tuple[list[float], str]:
    """
    Describe an image with Gemini Vision, then embed the description.

    Returns:
        (vector, description) tuple.
    """
    image_part = {"mime_type": mime_type, "data": image_bytes}
    response = _vision_model.generate_content(
        [image_part, "Describe this image in detail for a physics study context. Include all text, labels, diagrams, and data visible."]
    )
    description = response.text.strip()
    vector = _embed_single(description, "RETRIEVAL_DOCUMENT")
    return vector, description
