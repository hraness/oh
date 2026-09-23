# Oh and Wordcell

Oh is a memory framework for applications. Wordcell is a knowledge base built
from Markdown files. They share graph primitives while keeping ownership clear.

| Responsibility | Oh | Wordcell |
| --- | --- | --- |
| Durable content | Typed records and an append-only operation log | Markdown notes, attachments, and Git history |
| Graph | Versioned records, dependencies, projections, and proofs | Links, metadata, and note relationships projected into Oh |
| Retrieval | Keyword, semantic, and local reranking APIs | Vault search, context assembly, and its configured reranking provider |
| User workflow | SDK, CLI, and Agent Skill for building memory | Capture, author, navigate, query, evaluate, and publish a vault |

## Follow a note into a graph answer

An authored note stays in the vault. Graph queries work without a setup step:
Wordcell derives a temporary in-memory projection from the current files and
returns bounded proof paths back to the notes. For a persistent local projection,
`wordcell graph rebuild` creates a gitignored `.wordcell/oh.sqlite` database.
Deleting this derived database loses no authored content: rebuild it from the
vault. Queries and rebuilds do not rewrite Markdown.

Wordcell keeps this integration behind its engine-neutral graph-authority port.
It pins an immutable Oh release and verifies upgrades independently. It does not
depend on an Oh checkout, a moving branch, or a running Oh service.

## Choose the right entry point

Start with [Wordcell](https://wordcell.io) when the product is a collection of
notes you and your agents maintain. Its capture, search, graph, and publication
workflows operate on ordinary files.

Start with [Oh’s SDK](../README.md#use-the-sdk) when an application owns the
memory records and needs explicit mutation, replay, retrieval, and proof
contracts. The memory-host API can keep a disposable working space separate
from a pinned canonical graph; application policy controls what crosses that
boundary.

## Read benchmark results at their measured scope

Oh’s memory studies measure particular retrieval procedures and reader setups.
Wordcell’s evaluations measure its vault-search pipeline. Embedding the Oh
graph does not activate Oh’s reranker or inherit its answer-accuracy results.
The two sites use the same released chart primitive and display the dataset,
metric, sample, model, and evidence link beside each comparison.

See [Oh’s benchmark record](../benchmarks/README.md) and
[Wordcell’s source and evaluations](https://github.com/hraness/wordcell).
