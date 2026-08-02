---
title: 'Design by Contract and effects are essential for LLM-generated code'
date: '2026-08-02'
tags: ['programming', 'llms']
draft: false
summary: 'As LLMs write more code, contracts and effect systems become essential tools for constraining behavior, exposing side effects, and verifying implementations.'
images: ['/static/images/gemini-design-by-contract-effects-opengraph.svg']
---

In this post, I want to discuss two language features that I think have become substantially more important as software development shifts from human-authored to LLM-authored code.

Like many others, the majority of the code I have "written" (prompted) and shipped in the last year was not authored by me. You feed specifications to an LLM, it spits out an implementation, and you ask it to write tests to verify the behavior. You run the tests, manually poke the app to see if it behaves how you expect, and if you have the time you review the code.

This sort of development loop gives immense value to "code that verifiably does what it says on the tin."

There are two programming language features that facilitate this, and I'm convinced that their value is tenfold in this new era of machine-generated code:

1. Design-by-Contract
2. Effects

The net result of these is the possibility to have compiler-generated reports of _semantic_ changes in a PR, like:

```yaml
Effects added: PaymentProcessor.process
  + net.connect
  + retry.nondeterministic

Postcondition weakened: Ledger.append
  - ensures ledger.length == old(ledger.length) + 1
```

> **AI (Dis)use Disclaimer:** No part of the prose was machine-generated. You will not find machine-written prose on this blog. I consider it deeply disrespectful.

## Design-by-Contract

Design-by-Contract (DbC) is language/syntax feature that allows writing preconditions, postconditions, and invariants (always-true) as part of the signature of methods and structs/classes.

It's somewhere between a mix of ad-hoc testing and formal specification. In many languages, contracts have build-time "level" switches which toggle the behavior and checks from compile-time to run-time, for performance reasons.

A picture is worth a thousand words, so rather than continue describing Contracts, let me give some (hopefully) self-explanatory examples.

Suppose we have a `User` type:

```rust
struct User {
    email: String
    email_verified: Bool
}
```

Nothing prevents this state:

```rust
User {
    email: "",
    email_verified: true
}
```

But with Design-by-Contract, we can encode a few simple invariants to rule it out:

```rust
struct User {
    email: String
    email_verified: Bool

    invariant email.is_valid_email()
    invariant email_verified implies !email.is_empty()
}
```

Changing the email can then specify what else must change:

```rust
fn change_email(user: &mut User, new_email: String)
    requires new_email.is_valid_email()

    ensures user.email == new_email
    ensures user.email_verified == false
```

Without the postcondition `ensures`, a generated implementation might update the address while leaving `email_verified` set to `true`.

Data structures whose properties can be encoded as invariant conditions are particularly well suited to this sort of design:

```rust
struct MinHeap<T: Ordered> {
    items: Array<T>

    invariant forall i in 1..<items.length:
        items[parent(i)] <= items[i]
}
```

```rust
struct BTreeNode<K, V, const ORDER: usize> {
    keys: Array<K>
    values: Array<V>
    children: Array<NodeRef>

    is_leaf: bool

    invariant keys.length == values.length
    invariant keys.length <= ORDER - 1

    invariant strictly_increasing(keys)

    invariant is_leaf
        implies children.length == 0

    invariant !is_leaf
        implies children.length == keys.length + 1
}
```

## Effects

Effects are a way to denote explicit capabilities in methods.

Typically these are behaviors such as "file/network IO, memory allocation, state changes", etc. By requiring that method effects be explicit, you can use a method's signature as a verified contract of its permitted behaviors.

As one example, suppose we have a method:

```rust
fn load_settings(path: Path) -> Settings
```

The return type says nothing about where the settings come from or what the operation may do.

An effect-aware signature does:

```rust
fn load_settings(path: Path) -> Settings
    requires path.exists()
    requires path.is_file()

    ensures result.is_valid()

    effects {
        fs.read(path),
        alloc
    }
```

Now compare that with a function that merely parses settings already held in memory:

```rust
fn parse_settings(contents: String) -> Settings
    requires !contents.is_empty()

    ensures result.is_valid()

    effects {
        alloc
    }
```

These functions may return the same TYPE, but they have meaningfully different OPERATIONAL behavior. That difference should be visible at the call site.

A few more examples:

1. Cache `get` that updates `recency` internal metadata

At first glance, you might think that the below method is read-only:

```rust
fn get(cache: &mut Cache<K, V>, key: K) -> Option<V>
```

But many caches maintain usage statistics, and it may be the case that our `get` method is mutating. The below signature is explicit about behavior like this:

```rust
fn get(cache: &mut Cache<K, V>, key: K) -> Option<V>
    ensures result.is_some() == old(cache.contains(key))
    ensures cache.entries == old(cache.entries)

    effects {
        state.write(cache.recency)
    }
```

The cache contents do not change, but its eviction metadata does.

2. A function that must not allocate

Suppose that we have a method which writes/encodes some value into a caller-supplied buffer:

```rust
fn encode(
    value: Message,
    destination: &mut ByteBuffer
) -> usize
    requires destination.remaining >= value.encoded_size()

    ensures result == value.encoded_size()
    ensures destination.position == old(destination.position) + result

    effects {
        memory.write(destination)
    }
```

The implementation can write into the supplied buffer but cannot create a temporary array or string (because it does not possess the `alloc` effect)
