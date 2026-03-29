import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY      = os.environ["GEMINI_API_KEY"]
PINECONE_API_KEY    = os.environ["PINECONE_API_KEY"]
PINECONE_INDEX_NAME = os.environ["PINECONE_INDEX_NAME"]
OPENROUTER_API_KEY  = os.environ["OPENROUTER_API_KEY"]
OPENROUTER_MODEL    = os.environ.get("OPENROUTER_MODEL", "anthropic/claude-3.5-haiku")
PINECONE_CLOUD      = os.environ.get("PINECONE_CLOUD", "aws")
PINECONE_REGION     = os.environ.get("PINECONE_REGION", "us-east-1")

# Chunking
CHUNK_SIZE_CHARS    = 2048   # ~512 tokens at 4 chars/token
CHUNK_OVERLAP_CHARS = 256    # ~64 tokens overlap

# Retrieval
TOP_K               = 5

# Embedding
EMBEDDING_MODEL     = "models/gemini-embedding-2-preview"
EMBEDDING_DIMENSION = 3072

# Pinecone upsert
UPSERT_BATCH_SIZE   = 100
