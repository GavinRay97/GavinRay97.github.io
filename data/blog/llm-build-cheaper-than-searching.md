---
title: 'Disposable Software: When generating code costs less than finding it'
date: '2026-02-28'
tags: ['non-technical', 'ai', 'opinion', 'software-engineering']
draft: false
summary: "LLMs have made generating code nearly free, but maintaining it hasn't changed. On the growing plague of code that shouldn't exist and the discipline of searching before building."
images: ['/static/images/llm-build-vs-search.svg']
---

Last week, I reviewed a PR that contained a 3,000 line reimplementation of existing services.
It had tests, was well-documented -- but also could have been an `import` statement.

There's a phenomena I've been experiencing lately that is unsettling: The accumulation of code that shouldn't exist.

Some examples:

- A PR contains a reimplementation of several existing services in a monorepo that could have `import`ed
- Bespoke GUI's and CLI tools for usecases that well-known Unix tools have addressed for decades
- 300-500 line TS/Python scripts to do things like parse + aggregate CSV/JSON

I can't say I blame people for this.

Which is easier: _**"Hey LLM, build this thing"**_, or searching a repo/the internet to see whether something exists that does what you need?

The balance between the cost of writing code, and the cost of information searching, has shifted dramatically.

## Cost doesn't vanish, it relocates

Generating code is now (roughly) free. MAINTAINING code hasn't changed a bit.

_**"Code is a liability, not an asset."**_ took me a decade to appreciate properly.

When we use an LLM to generate a new tool/service rather than importing the existing one, we create an island. If the original gets patched or upgraded, we have to remember to port that work. (Or, more authentically, forget we need to port it. Whoops.)

We've now traded a short-term reduction in cognitive effort for a long-term explosion in maintenance burden.

AI is facilitating _**"Not Invented Here"**_ at warp speed -- ironically often without the author FEELING like they invented anything.

## The "First Person in History" test

One question that's saved me a massive amount of pain:

Before writing (or asking an LLM to write), I ask: **Am I the first person in history to have encountered this exact problem?**

- **YES**: Genuinely novel problem -- Build something.
- **NO**: Does any existing solution (library, service, or pipeline of standard tools) do what I need?
  - **YES**: Use it, unless there's a _damn_ good reason not to.
  - \*_NO_: Okay, build something.

## Ask LLM's to _Find_ before _Build_

LLM's can both build AND search. They just sort of seem to default to building.

I find that deliberately redirecting towards "find" can prevent a lot of cruft. Before new implementations, I usually prompt something along the lines of:

> _Given this repo structure and this problem, what's the closest existing module, stdlib function, or well-known tool that already solves this? What should I search for?_

This takes about 15 seconds and prevents the majority of unnecessary code.

Sometimes I wouldn't have been able to discover it alone, because I'd have used the wrong terms/looked in the wrong places.

## "Never Build" is not realistic

The heuristic isn't "never build." That's not feasible, there are sometimes genuine reasons why you should roll-youw-own:

- Performance or memory constraints where general tools can't cut it
- Privacy/compliance requirements that exclude third-party dependencies touching sensitive data
- The problem genuinely is novel (it DOES happen, just less often than we think)

BUT -- **the default should be reuse**. Building should require a deliberate, written-down/recorded justification.

## I don't have a good heading for the ending paragraph so I put this

Engineering skill isn't "I can build stuff/write code fast". It's _**having the discipline to know when not to write at all.**_

We're all still figuring out how to stay sharp when generating code is essentially free.

The engineers who thrive will be the ones who treat new code as a cost center -- not a deliverable.

---

**AI Use Disclaimer:** `claude code` was used to generate the [OpenGraph SVG image](/static/images/llm-build-vs-search.svg)

No part of the prose was machine-generated. You will not find machine-written prose on this blog. I consider it deeply disrespectful.
