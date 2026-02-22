---
title: 'The Absurdity of the term "AI Engineer"'
date: '2026-02-22'
tags: ['non-technical', 'ai', 'opinion']
draft: false
summary: 'Integrating a third-party LLM SDK does not make you an AI Engineer: a rant on the inflation of job titles in the age of ChatGPT wrappers.'
images: ['/static/images/ai-engineer-title-absurdity.svg']
---

Catching up with a friend recently, he mentioned that his org was looking to hire an "AI Engineer".

The platform is a stock-standard B2B CRUD SaaS, so this statement confused me.

I could not imagine why they would be doing sophisticated, low-level AI work.

When I pressed for details, it became apparent that they did not, in fact, want an "AI Engineer".

**They wanted an engineer to build a chatbox that called ChatGPT with company documents as prompt context.**

I don't know about you, but "back in my day", integrating third-party SDK's/API's for app functionality was _most_ of the product work required to launch a SaaS.

Slap a UI on top of CRUD forms, and a slew of libs for things like: Auth, Email/SMS, Storage, Billing, Cloud Infra, etc...

Any engineer who has spent time in the "launch SaaS fast" startup gauntlet will tell you that integration is at _LEAST_ half of greenfield app work.

Let's play a game called **"Guess The Job Description"**.

1. A _**"Database Engineer"**_ is someone who:

   - Installs and uses database client libraries
   - Develops features of a database engine

2. A _**"UI Engineer"**_ is someone who:
   - Integrates UI libraries like Material UI, Ant Design, or shadcn
   - Designs and develops user interfaces for an application

Aren't these fun! Okay, one more:

3. An _**"AI Engineer"**_ is someone who:
   - Installs, uses, and configures LLM libraries with appropriate context
   - Works on ML model design, training, and implementation

---

In closing, **the next time I hear someone describe themselves as an "AI Engineer" for consuming a third-party SDK, I'm going to have an aneurysm,** I think.

---

**AI Use Disclaimer:** `claude code` was used to generate the [OpenGraph SVG image](/static/images/ai-engineer-title-absurdity.svg)

No part of the prose was machine-generated. You will not find machine-written prose on this blog. I consider it deeply disrespectful.
