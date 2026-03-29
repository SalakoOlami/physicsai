#!/usr/bin/env python3
"""
ingest.py — Chunk, embed, and upsert documents into Pinecone.

Usage:
  python ingest.py --path path/to/file.pdf
  python ingest.py --path path/to/file.txt
  python ingest.py --path path/to/file.docx
  python ingest.py --path path/to/image.png
  python ingest.py --dir  path/to/docs/
  python ingest.py --dir  path/to/docs/ --recursive
"""
import argparse
from pathlib import Path

from tqdm import tqdm
from rich.console import Console

import src.config as config  # triggers dotenv load
from src.pdf_loader import load_pdf, load_text, load_docx, load_doc, load_pptx, load_image
from src.chunker import chunk_text
from src.embedder import embed_documents, embed_image
from src.pinecone_store import get_client, ensure_index, upsert_chunks

console = Console()

TEXT_EXTENSIONS = {".txt", ".pdf", ".docx", ".doc", ".pptx"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | IMAGE_EXTENSIONS


def collect_files(args) -> list[Path]:
    if args.path:
        p = Path(args.path)
        if p.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {p.suffix}. Supported: {SUPPORTED_EXTENSIONS}")
        return [p]
    if args.dir:
        d = Path(args.dir)
        pattern = "**/*" if args.recursive else "*"
        return sorted(
            f for f in d.glob(pattern)
            if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
        )
    raise ValueError("Provide --path or --dir")


def process_text_file(file_path: Path) -> list[dict]:
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        pages = load_pdf(file_path)
        modality = "pdf"
    elif ext == ".docx":
        pages = load_docx(file_path)
        modality = "docx"
    elif ext == ".doc":
        pages = load_doc(file_path)
        modality = "doc"
    elif ext == ".pptx":
        pages = load_pptx(file_path)
        modality = "pptx"
    else:
        pages = load_text(file_path)
        modality = "text"

    all_chunks = []
    for page in pages:
        chunks = chunk_text(
            text=page["text"],
            metadata={
                "source": page["source"],
                "page_number": page.get("page_number"),
                "modality": modality,
            },
        )
        all_chunks.extend(chunks)
    return all_chunks


def main():
    parser = argparse.ArgumentParser(description="Ingest documents into Pinecone RAG index")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--path", type=str, help="Path to a single file")
    group.add_argument("--dir",  type=str, help="Directory containing files to ingest")
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Recurse into subdirectories (only with --dir)",
    )
    args = parser.parse_args()

    files = collect_files(args)
    if not files:
        console.print("[yellow]No supported files found.[/yellow]")
        return

    console.print(f"[bold green]Found {len(files)} file(s) to ingest.[/bold green]")

    pc = get_client()
    ensure_index(pc)
    console.print(f"[cyan]Pinecone index '{config.PINECONE_INDEX_NAME}' is ready.[/cyan]\n")

    total_vectors = 0
    for file_path in tqdm(files, desc="Files", unit="file"):
        ext = file_path.suffix.lower()

        if ext in IMAGE_EXTENSIONS:
            # Image path: describe with Gemini Vision, embed description as one vector
            img = load_image(file_path)
            try:
                vector, description = embed_image(img["bytes"], img["mime_type"])
            except Exception as e:
                console.print(f"  [yellow]Skipping {file_path.name} — image embedding failed: {e}[/yellow]")
                continue

            chunk = {
                "text": description,
                "source": img["source"],
                "page_number": 0,
                "modality": "image",
                "chunk_index": 0,
            }
            n = upsert_chunks(pc, [chunk], [vector])
            total_vectors += n
            console.print(f"  [green]{file_path.name}[/green]: image described → {n} vector upserted")

        else:
            # Text/document path: chunk → embed → upsert
            chunks = process_text_file(file_path)
            if not chunks:
                console.print(f"  [yellow]Skipping {file_path.name} — no extractable text.[/yellow]")
                continue

            texts = [c["text"] for c in chunks]
            embeddings = embed_documents(texts)
            n = upsert_chunks(pc, chunks, embeddings)
            total_vectors += n
            console.print(f"  [green]{file_path.name}[/green]: {len(chunks)} chunks → {n} vectors upserted")

    console.print(f"\n[bold]Done. Total vectors upserted: {total_vectors}[/bold]")


if __name__ == "__main__":
    main()
