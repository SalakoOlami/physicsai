#!/usr/bin/env python3
"""
query.py — Query the RAG system with natural language.

Usage:
  python query.py "What does the document say about X?"
  python query.py "Summarize the main findings" --top-k 8
  python query.py "What is X?" --show-sources
"""
import argparse

from rich.console import Console
from rich.panel import Panel

import src.config as config  # triggers dotenv load
from src.embedder import embed_query
from src.pinecone_store import get_client, query_index
from src.openrouter import stream_answer

console = Console()


def main():
    parser = argparse.ArgumentParser(description="Query the RAG system")
    parser.add_argument("question", type=str, help="Natural language question")
    parser.add_argument(
        "--top-k",
        type=int,
        default=config.TOP_K,
        help=f"Number of chunks to retrieve (default: {config.TOP_K})",
    )
    parser.add_argument(
        "--show-sources",
        action="store_true",
        help="Print the retrieved source chunks before the answer",
    )
    args = parser.parse_args()

    console.print(f"\n[bold cyan]Query:[/bold cyan] {args.question}\n")

    with console.status("Embedding query..."):
        q_embedding = embed_query(args.question)

    with console.status(f"Retrieving top-{args.top_k} chunks from Pinecone..."):
        pc = get_client()
        matches = query_index(pc, q_embedding, top_k=args.top_k)

    if not matches:
        console.print("[red]No relevant chunks found in the index. Have you run ingest.py yet?[/red]")
        return

    if args.show_sources:
        console.print(
            Panel.fit(
                "\n\n".join(
                    f"[bold]{i + 1}. {m['source']}"
                    + (f" p.{m['page_number']}" if m.get("page_number") else "")
                    + f"[/bold] (score={m['score']:.4f})\n{m['text'][:300]}..."
                    for i, m in enumerate(matches)
                ),
                title="Retrieved Chunks",
                border_style="blue",
            )
        )

    console.print("[bold green]Answer:[/bold green]")
    stream_answer(args.question, matches)


if __name__ == "__main__":
    main()
