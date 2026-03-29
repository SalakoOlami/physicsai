import time
import uuid
from pinecone import Pinecone, ServerlessSpec
from src.config import (
    PINECONE_API_KEY,
    PINECONE_INDEX_NAME,
    PINECONE_CLOUD,
    PINECONE_REGION,
    UPSERT_BATCH_SIZE,
    TOP_K,
)


def get_client() -> Pinecone:
    return Pinecone(api_key=PINECONE_API_KEY)


def ensure_index(pc: Pinecone) -> None:
    """Create the Pinecone serverless index if it doesn't exist, then wait until ready."""
    existing = [idx.name for idx in pc.list_indexes()]
    if PINECONE_INDEX_NAME not in existing:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=3072,
            metric="cosine",
            spec=ServerlessSpec(
                cloud=PINECONE_CLOUD,
                region=PINECONE_REGION,
            ),
        )
        while not pc.describe_index(PINECONE_INDEX_NAME).status["ready"]:
            time.sleep(1)


def upsert_chunks(
    pc: Pinecone,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> int:
    """
    Upsert embedded chunks into Pinecone in batches.

    Args:
        pc: Pinecone client.
        chunks: List of chunk dicts with keys: text, chunk_index, source, modality, page_number.
        embeddings: Parallel list of float vectors.

    Returns:
        Total number of vectors upserted.
    """
    index = pc.Index(PINECONE_INDEX_NAME)
    vectors = [
        {
            "id": str(uuid.uuid4()),
            "values": embedding,
            "metadata": {
                "text": chunk["text"],
                "source": chunk["source"],
                "chunk_index": chunk["chunk_index"],
                "page_number": chunk.get("page_number"),
                "modality": chunk["modality"],
            },
        }
        for chunk, embedding in zip(chunks, embeddings)
    ]

    total = 0
    for i in range(0, len(vectors), UPSERT_BATCH_SIZE):
        batch = vectors[i : i + UPSERT_BATCH_SIZE]
        index.upsert(vectors=batch)
        total += len(batch)
    return total


def query_index(
    pc: Pinecone,
    query_embedding: list[float],
    top_k: int = TOP_K,
) -> list[dict]:
    """
    Retrieve the top-k most similar chunks for a query embedding.

    Returns:
        List of dicts: {score, text, source, page_number, chunk_index, modality}
    """
    index = pc.Index(PINECONE_INDEX_NAME)
    response = index.query(
        vector=query_embedding,
        top_k=top_k,
        include_metadata=True,
    )
    return [
        {"score": match["score"], **match["metadata"]}
        for match in response["matches"]
    ]
