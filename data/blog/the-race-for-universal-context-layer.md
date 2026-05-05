---
title: 'The Race to Become the Context Layer for Agents'
date: '2026-05-05'
tags: ['ai', 'llm', 'agents', 'data']
draft: false
summary: 'The next data platform may be less about storing data and more about deciding what AI agents should know, trust, and act on.'
images: ['blogpost-context-layer-for-agents-banner.png']
---

# The Race to Become the Context Layer for Agents

I opened HN today and saw Airbyte Agents, right after Googles Agentic Data Cloud announcement and the SAP-Dremio acquisition.

> Disclosure: my employer also works in this space, so I'm not a neutral observer.

By analogy: Hire the most capable engineer in the world, they are useless on day one if they do not understand your codebase, customers, the data model, internal lingo, the permission boundaries, or the history behind the weird edge cases.

Agents have these same problems.

For most consumers of agentic models, the highest-leverage knob is context. "More context" is easy. "Right context" is the thorny bit: permissioned, semantically meaningful, fresh, cheap to retrieve, and tied to actions the agent is allowed to take.

From the outside, that seems to be where the market is converging:

- Google pitching an Agentic Data Cloud with a universal context engine and "Knowledge Catalog".
- SAP acquiring Dremio to build an open catalog / semantic layer.
- Airbyte launching Agents as a context layer over operational systems.

The need for this sort of thing already feels obvious. But the hard part is not connecting the agent to everything.

- Who can make that access trustworthy?
- Which source of context is authoritative?
- How do lineage and permissions propagate across systems?
- How do you match entities across disparate sources?
- How does an agent know it has _enough_ context to act safely?

My $0.02:

The platforms that win won't be the ones that build the best data dictionary. They will be the ones that own the hardest parts of the query engine internals and connector architecture, guaranteeing that when an agent decides to act, the translation layer doesn't bring the whole system down.

---

**AI Use Disclaimer:** `chatgpt 5.5` was used to generate the [OpenGraph image](/static/images/blogpost-context-layer-for-agents-banner.png)

No part of the prose was machine-generated. You will not find machine-written prose on this blog. I consider it deeply disrespectful.
