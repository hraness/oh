# Oh and Wordcell

Wordcell uses Oh to answer graph queries over your Markdown notes. Each answer
comes with a proof that leads back to the notes behind it, and your vault
stays the one place that holds what you wrote.

[Wordcell](https://wordcell.io) is a knowledge base for agents: markdown,
backlinks, search, ontology, and git context. Oh is open-source memory for
agents that stores each fact with its sources and every change in a history
you can replay. Wordcell builds its graph with Oh’s record format and rule
engine, and each product keeps its own responsibilities:

| Responsibility | Oh | Wordcell |
| --- | --- | --- |
| Durable content | Records, each of a declared kind, and an append-only operation log | Markdown notes, attachments, and Git history |
| Graph | Versioned records, their dependencies, results derived by rules, and proofs | Links, metadata, and note relationships, loaded into Oh as derived records |
| Retrieval | Keyword, semantic, and local reranking APIs | Vault search, context assembly, and its configured reranking provider |
| User workflow | SDK, CLI, and Agent Skill for building memory | Capture, author, navigate, query, evaluate, and publish a vault |

## Follow a note into a graph answer

Your notes stay in the vault, the folder of Markdown files that Wordcell
manages. A graph query needs no setup step. Wordcell reads the current files,
loads them into a temporary Oh graph in memory, and answers from it. Each
result’s proof traces it back through the rules to the notes it came from,
and Wordcell limits how deep and how large a proof can grow.

To keep the graph between runs, run `wordcell graph rebuild`. It writes the
graph to `.wordcell/oh.sqlite`, a SQLite database that Git ignores. The
database is derived from your notes and holds nothing you wrote, so deleting
it loses no authored content: run the rebuild again to recreate it from the
vault. Queries and rebuilds never change your Markdown.

Wordcell’s graph code reaches Oh through one module in its own source,
`src/graph-authority.ts`, whose interface doesn’t assume any particular graph
engine. Behind that module, Wordcell holds the graph with `@hraness/oh/store`
and `@hraness/oh/sqlite`, and runs rules with `@hraness/oh/projection`, which
evaluates them over facts taken from the records and returns each result with
its proof. Wordcell pins one immutable Oh release and verifies each upgrade
itself, on its own schedule. It doesn’t depend on a checkout of Oh’s source, a
moving branch, or a running Oh service.

## Choose where to start

Start with [Wordcell](https://wordcell.io) when the product is a collection of
notes that you and your agents maintain. Its capture, search, graph, and
publishing workflows work on ordinary files.

Start with [Oh’s SDK](../README.md#use-the-sdk) when your application keeps
its own memory records and needs explicit writes, replay, retrieval, and
proofs, each defined in Oh’s versioned specification. The
[memory host API](memory-runtime.md) keeps a working store, which you can
discard, apart from canonical memory: the reviewed records your agent reads
at a point in history that you pin. Your application’s own rules decide what
moves from the working store into canonical memory.

## What each product’s benchmarks measure

Oh’s memory studies measure particular retrieval procedures with particular
reader setups, where the reader is the model that reads the retrieved memory
and writes the answer. Wordcell’s evaluations measure its vault-search
pipeline. Running Oh’s graph inside Wordcell doesn’t turn on Oh’s reranker,
and Oh’s answer-accuracy results don’t carry over to Wordcell.

Oh’s website and Wordcell’s website draw their comparisons with the same
published chart component, and each chart shows its dataset, metric, sample,
model, and a link to the evidence.

See [Oh’s benchmark results](../benchmarks/README.md) and
[Wordcell’s source and evaluations](https://github.com/hraness/wordcell).
