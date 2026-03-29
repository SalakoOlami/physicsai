from langchain_text_splitters import RecursiveCharacterTextSplitter
from src.config import CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS


def get_splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE_CHARS,
        chunk_overlap=CHUNK_OVERLAP_CHARS,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
        is_separator_regex=False,
    )


def chunk_text(text: str, metadata: dict) -> list[dict]:
    """
    Split text into overlapping chunks with metadata attached.

    Args:
        text: Raw text content to split.
        metadata: Must include 'source', 'modality', and optionally 'page_number'.

    Returns:
        List of dicts: {text, chunk_index, source, modality, page_number, ...}
    """
    splitter = get_splitter()
    chunks = splitter.split_text(text)
    return [
        {"text": chunk, "chunk_index": i, **metadata}
        for i, chunk in enumerate(chunks)
        if chunk.strip()
    ]
