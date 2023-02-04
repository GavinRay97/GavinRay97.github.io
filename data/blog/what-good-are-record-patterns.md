---
title: "What good are Record Patterns in Java? An example based on Spark's Catalyst Optimizer and it's Tree Rewriting Rules"
date: '2023-02-04'
tags: ['java', 'jdk', 'jvm']
draft: false
summary: >
  A tutorial on how to use Java's new Record Patterns feature to write powerful, concise pattern matching code for usecases like AST transformations and rewrite-rules in compiler passes.
images: ['/static/images/ast-visualization.png']
---

<TOCInline toc={props.toc} indentDepth={2} asDisclosure />

---

# Preface

Recently, Gunnar Morling made a stellar [tweet](https://twitter.com/gunnarmorling/status/1619412551200301057) about how he was interested in hearing of usecases for Java's new [Record Patterns](https://openjdk.org/jeps/405) feature. My dayjob involves a lot of work with AST/IR and a sort of `Query Expression Language`, so I immediately grew excited at being able to share this sort of usecase with the community.

<blockquote className="twitter-tweet">
    <span lang="en" dir="ltr">
        Playing around a bit with
        <a href="https://twitter.com/hashtag/Java?src=hash&amp;ref_src=twsrc%5Etfw">#Java</a> 19/20 record patterns. I
        generally like the ergonomics of it, matching whole object trees is kinda fun. `var` helps to gloss over
        irrelevant parts of the tree, might be even more concise though? Also curious what use cases folks see for this.
        <a href="https://t.co/v4NKUu6Cz7">pic.twitter.com/v4NKUu6Cz7</a>
    </span>
    &mdash; Gunnar Morling 🌍 (@gunnarmorling)
    <a href="https://twitter.com/gunnarmorling/status/1619412551200301057?ref_src=twsrc%5Etfw">January 28, 2023</a>
</blockquote>
<script async src="https://platform.twitter.com/widgets.js" charSet="utf-8"></script>

# What are Record Patterns?

Record Patterns are a new feature in Java 19/20 that allow you to write concise, powerful pattern matching code.

"Pattern Matching" is a term adopted from the "Functional Programming" world, and is a way of expressing a conditional statement in a declarative way. Rather than writing a series of `if`/`else if`/`else` statements, you can write a series of patterns that match against the input, and execute a block of code when a pattern matches.

This simple principle is tremendously powerful, due to the flexibility in how patterns can be used. Though this is heavily dependent on whether the patterns allow you to `nest` them, and to `bind` variables to the matched values (as we'll see below in a moment). Let's take a look at some examples of "traditional" POJO code, and how we might rewrite it using Records and Record Patterns using more "modern" Java with declarative style.

# A Simple Example

Let's start with a simple example of a `Person` class, which has a `name` and `age`:

## A Person POJO, what you're used to

```java
public class Person {
    private final String name;
    private final int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String getName() {
        return name;
    }

    public int getAge() {
        return age;
    }
}
```

Now, let's write a simple function that takes a `Person` and returns a `String` based on their age:

```java
public String getPersonStatus(Person person) {
    if (person.getAge() < 18) {
        return "Minor";
    } else if (person.getAge() < 65) {
        return "Adult";
    } else {
        return "Senior";
    }
}
```

## Let's rewrite it with Records and Record Patterns

This is a simple example, but it's already starting to get a bit messy. We have to write a lot of boilerplate code, and we have to repeat the `person.getAge()` call multiple times. Let's see how we can rewrite this using Record Patterns:

```java
record Person(String name, int age) {}

public String getPersonStatus(Person person) {
    return switch (person) {
        case Person(var _, var age) when age < 18 -> "Minor";
        case Person(var _, var age) when age < 65 -> "Adult";
        default -> "Senior";
    };
}
```

## What else can we do?

That's a lot better!

This is just the tip of the iceberg though. We can do lots of things in patterns like:

1. Use interface/superclass types in patterns, which will match based on specificity
2. Nest patterns in our `case` statements

```java
sealed interface Shape permits Circle, Rectangle, Square {}
record Circle(double radius) implements Shape {}
record Rectangle(double width, double height) implements Shape {}
record Square(double side) implements Shape {}

public double getArea(Shape shape) {
    return switch (shape) {
        case Circle(var radius) -> Math.PI * radius * radius;
        case Rectangle(var width, var height) -> width * height;
        case Square(var side) -> side * side;
    };
}
```

```java
record PhoneNumber(String countryCode, String areaCode, String number) {}
record Person(String name, int age, PhoneNumber phoneNumber) {}

// I'm using "_" for readability here, this won't compile
public List<Person> getPeopleWithAreaCode(List<Person> people, String areaCode) {
    return people.stream()
        .filter(person -> switch (person) {
            // Silly example for demo, doesn't make a lot of sense
            case Person(_, _, PhoneNumber(_, var areaCode, _)) -> true;
            default -> false;
        })
        .toList();
}
```

# The Usecase: Tree Rewriting/AST Transformations

Now that we've seen some examples of how Record Patterns can be used, let's take a look at a real-world usecase for them: Tree Rewriting/AST Transformations.

## What is Tree Rewriting?

Tree rewriting is a technique used in compilers to transform the AST/IR of a program. This is done by writing a series of rewrite rules that match against the AST, and then rewrite the AST based on the matched rules.

For example, let's say we have a simple `Expression` AST:

```java
sealed interface Expr permits Add, Sub, Mul, Div, Const, Var {}

record Add(Expr left, Expr right) implements Expr {}
record Sub(Expr left, Expr right) implements Expr {}
record Mul(Expr left, Expr right) implements Expr {}
record Div(Expr left, Expr right) implements Expr {}

record Const(int value) implements Expr {}
record Var(String name) implements Expr {}
```

We can then write a simple `eval` function that evaluates the expression, given a map of variable names to values (the `enviroment`):

```java
class Evaluator {
    public static int evaluate(Expr expr, Map<String, Integer> env) {
        return switch (expr) {
            case Add(Expr left, Expr right) -> evaluate(left, env) + evaluate(right, env);
            case Sub(Expr left, Expr right) -> evaluate(left, env) - evaluate(right, env);
            case Mul(Expr left, Expr right) -> evaluate(left, env) * evaluate(right, env);
            case Div(Expr left, Expr right) -> evaluate(left, env) / evaluate(right, env);
            case Const(int value) -> value;
            case Var(String name) -> env.get(name);
        };
    }
}
```

A rewrite-rule would be a pattern that matches against the `Expr` AST, and then rewrites it to a new `Expr` AST. For example, we could write a rule that rewrites `x + 0` to just `x`.

In the Apache Spark project, the Scala language makes it incredibly easy to write such rules using `case classes` and `case` statements. The [Catalyst optimizer code](https://github.com/apache/spark/blob/master/sql/catalyst/src/main/scala/org/apache/spark/sql/catalyst/optimizer/Optimizer.scala) is full of such rewrite rules, and it's a joy to read.

## How can Record Patterns help?

Let's take the above example of a rule that rewrites `x + 0` to just `x`.

We can write this rule as follows, using Record Patterns (going a bit further than just `x + 0`, to cover some more cases):

```java
class SimplifyZeroOpPass {
    public static Expr simplify(Expr expr) {
        return switch (expr) {
            // x + 0 = x
            case Add(Var(var name), Const(var value)) when value == 0 -> new Var(name);
            // 0 + x = x
            case Add(Const(var value), Var(var name)) when value == 0 -> new Var(name);
            // x - 0 = x
            case Sub(Var(var name), Const(var value)) when value == 0 -> new Var(name);
            // x * 1 = x
            case Mul(Var(var name), Const(var value)) when value == 1 -> new Var(name);
            // 1 * x = x
            case Mul(Const(var value), Var(var name)) when value == 1 -> new Var(name);
            // x / 1 = x
            case Div(Var(var name), Const(var value)) when value == 1 -> new Var(name);
            // 0 / x = 0
            case Div(Const(var value), Var(var name)) when value == 0 -> new Const(0);
            // Otherwise, just return the expression
            default -> expr;
        };
    }
}
```

Can you imagine if we had to write this using traditional `instanceof` and `if` statements? It would be a nightmare!

It would be something like this (Not checked for accuracy):

```java
class SimplifyZeroOpPass {
    public static Expr simplify(Expr expr) {
        if (expr instanceof Add add) {
            if (add.left() instanceof Var leftVar && add.right() instanceof Const rightConst && rightConst.value() == 0) {
                return leftVar;
            } else if (add.left() instanceof Const leftConst && add.right() instanceof Var rightVar && leftConst.value() == 0) {
                return rightVar;
            }
        } else if (expr instanceof Sub sub) {
            if (sub.left() instanceof Var leftVar && sub.right() instanceof Const rightConst && rightConst.value() == 0) {
                return leftVar;
            }
        } else if (expr instanceof Mul mul) {
            if (mul.left() instanceof Var leftVar && mul.right() instanceof Const rightConst && rightConst.value() == 1) {
                return leftVar;
            } else if (mul.left() instanceof Const leftConst && mul.right() instanceof Var rightVar && leftConst.value() == 1) {
                return rightVar;
            }
        } else if (expr instanceof Div div) {
            if (div.left() instanceof Var leftVar && div.right() instanceof Const rightConst && rightConst.value() == 1) {
                return leftVar;
            } else if (div.left() instanceof Const leftConst && div.right() instanceof Var rightVar && leftConst.value() == 0) {
                return new Const(0);
            }
        }

        return expr;
    }
}
```

## Implementing the Rewriter

To wrap up, I'm going to share the implementation of a full program that provides a multi-pass expression simplifier, using Record Patterns.

This is going to be a little bit of a [Draw the rest of the owl](https://knowyourmeme.com/memes/how-to-draw-an-owl) situation, because I feel like the above has already covered the majority of what background the reader needs for understanding the code.

What we're going to do is write a program that takes a mathematical expression, and simplifies it using a series of rewrite rules.

Our two rewrite rules will be:

1. Constant Folding -- convert any expression like `Add(Const(1), Const(2))` to `Const(3)`.
2. Replace all `Const(x)` with `Const(42)`

If we run the below on Java 21 with `--enable-preview`:

```java
ExprRewriter rewriter = new ExprRewriter(
        new ConstantFoldingPass(),
        new ConstantRewritingPass(42));

// Create an expression tree for 1 + 2 * 3
Expr expr = new Add(new Const(1), new Mul(new Const(2), new Const(3)));

// Print the expression tree
System.out.println("Original: " + expr);

// Evaluate the expression tree
System.out.println("Result: " + Evaluator.evaluate(expr, Map.of()));

// Now rewrite the expression tree
Expr rewritten = rewriter.rewrite(expr);

// Print the rewritten expression tree
System.out.println("Rewritten: " + rewritten);

// Evaluate the rewritten expression tree
System.out.println("Result: " + Evaluator.evaluate(rewritten, Map.of()));
```

We get the following output:

```ruby
[user@MSI java-record-deconstruction-patterns]$ ./gradlew run

> Task :app:run
Original: Add[left=Const[value=1], right=Mul[left=Const[value=2], right=Const[value=3]]]
Result: 7
Folding Add[left=Const[value=1], right=Mul[left=Const[value=2], right=Const[value=3]]]
Folding Const[value=1]
Folding Mul[left=Const[value=2], right=Const[value=3]]
Rewriting Add[left=Const[value=1], right=Const[value=6]]
Rewriting Const[value=1]
Rewriting Const[value=6]
Rewritten: Add[left=Const[value=42], right=Const[value=42]]
Result: 84
```

Below is the full source code for the program:

```java
package deconstruction.patterns;

import java.util.List;
import java.util.Map;

sealed interface Expr permits Add, Sub, Mul, Div, Const, Var {}

record Add(Expr left, Expr right) implements Expr {}
record Sub(Expr left, Expr right) implements Expr {}
record Mul(Expr left, Expr right) implements Expr {}
record Div(Expr left, Expr right) implements Expr {}
record Const(int value) implements Expr {}
record Var(String name) implements Expr {}

class Evaluator {
    public static int evaluate(Expr expr, Map<String, Integer> env) {
        return switch (expr) {
            case Add(Expr left, Expr right) -> evaluate(left, env) + evaluate(right, env);
            case Sub(Expr left, Expr right) -> evaluate(left, env) - evaluate(right, env);
            case Mul(Expr left, Expr right) -> evaluate(left, env) * evaluate(right, env);
            case Div(Expr left, Expr right) -> evaluate(left, env) / evaluate(right, env);
            case Const(int value) -> value;
            case Var(String name) -> env.get(name);
        };
    }
}

// A pass which folds simple constant expressions like 1 + 2 into 3.
class SimpleConstantFolderPass {
    public static Expr fold(Expr expr) {
        System.out.println("Folding " + expr);
        return switch (expr) {
            case Add(Const left, Const right) -> new Const(left.value() + right.value());
            case Sub(Const left, Const right) -> new Const(left.value() - right.value());
            case Mul(Const left, Const right) -> new Const(left.value() * right.value());
            case Div(Const left, Const right) -> new Const(left.value() / right.value());
            case Add(Expr left, Expr right) -> new Add(fold(left), fold(right));
            case Sub(Expr left, Expr right) -> new Sub(fold(left), fold(right));
            case Mul(Expr left, Expr right) -> new Mul(fold(left), fold(right));
            case Div(Expr left, Expr right) -> new Div(fold(left), fold(right));
            case Const(int value) -> expr;
            case Var(String name) -> expr;
        };
    }
}

// An interface for an expression tree rewriting pass.
interface ExprRewritingPass {
    Expr rewrite(Expr expr);
}

// An interface for an expression rewriter
class ExprRewriter {
    private List<ExprRewritingPass> passes;

    ExprRewriter(ExprRewritingPass... passes) {
        this.passes = List.of(passes);
    }

    // Register a pass with the rewriter.
    public ExprRewriter register(ExprRewritingPass pass) {
        passes.add(pass);
        return this;
    }

    // Rewrite an expression tree.
    public Expr rewrite(Expr expr) {
        for (ExprRewritingPass pass : passes) {
            expr = pass.rewrite(expr);
        }
        return expr;
    }
}

// A pass which rewrites all variables to constants.
class ConstantRewritingPass implements ExprRewritingPass {
    private int constantValue;

    ConstantRewritingPass(int constantValue) {
        this.constantValue = constantValue;
    }

    public Expr rewrite(Expr expr) {
        System.out.println("Rewriting " + expr);
        return switch (expr) {
            case Add(Expr left, Expr right) -> new Add(rewrite(left), rewrite(right));
            case Sub(Expr left, Expr right) -> new Sub(rewrite(left), rewrite(right));
            case Mul(Expr left, Expr right) -> new Mul(rewrite(left), rewrite(right));
            case Div(Expr left, Expr right) -> new Div(rewrite(left), rewrite(right));
            case Const(int value) -> new Const(constantValue);
            case Var(String name) -> expr;
        };
    }
}

class ConstantFoldingPass implements ExprRewritingPass {
    public Expr rewrite(Expr expr) {
        System.out.println("Folding " + expr);
        return switch (expr) {
            case Add(Const left, Const right) -> new Const(left.value() + right.value());
            case Sub(Const left, Const right) -> new Const(left.value() - right.value());
            case Mul(Const left, Const right) -> new Const(left.value() * right.value());
            case Div(Const left, Const right) -> new Const(left.value() / right.value());
            case Add(Expr left, Expr right) -> new Add(rewrite(left), rewrite(right));
            case Sub(Expr left, Expr right) -> new Sub(rewrite(left), rewrite(right));
            case Mul(Expr left, Expr right) -> new Mul(rewrite(left), rewrite(right));
            case Div(Expr left, Expr right) -> new Div(rewrite(left), rewrite(right));
            case Const(int value) -> expr;
            case Var(String name) -> expr;
        };
    }
}

public class App {
    public static void main(String[] args) {

        ExprRewriter rewriter = new ExprRewriter(
                new ConstantFoldingPass(),
                new ConstantRewritingPass(42));

        // Create an expression tree for 1 + 2 * 3
        Expr expr = new Add(new Const(1), new Mul(new Const(2), new Const(3)));

        // Print the expression tree
        System.out.println("Original: " + expr);

        // Evaluate the expression tree
        System.out.println("Result: " + Evaluator.evaluate(expr, Map.of()));

        // Now rewrite the expression tree
        Expr rewritten = rewriter.rewrite(expr);

        // Print the rewritten expression tree
        System.out.println("Rewritten: " + rewritten);

        // Evaluate the rewritten expression tree
        System.out.println("Result: " + Evaluator.evaluate(rewritten, Map.of()));
    }
}
```

# Get the Source Code

The source code to this blog post is available on GitHub:

- https://github.com/GavinRay97/java-record-patterns

# Attribution

The OpenGraph image for this blog post was taken from a Google search for `tree ast code`, and is from a blog post by [Lachezar Nickolov](https://blog.sessionstack.com/how-javascript-works-parsing-abstract-syntax-trees-asts-5-tips-on-how-to-minimize-parse-time-abfcf7e8a0c8)

- https://blog.sessionstack.com/how-javascript-works-parsing-abstract-syntax-trees-asts-5-tips-on-how-to-minimize-parse-time-abfcf7e8a0c8
