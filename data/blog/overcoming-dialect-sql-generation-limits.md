---
title: 'AI SQL Generation: Overcoming dialect-specific syntax errors'
date: '2025-05-17'
tags: ['sql', 'text-to-sql', 'llms']
draft: false
summary: 'A discussion on techniques available to overcome semantic errors in syntax when generating dialect-specific SQL'
images: [/static/images/ai-sql-generation.png]
---

<TOCInline toc={props.toc} indentDepth={3} asDisclosure />

---

# Introduction

Recently, I've noticed several comments about the difficulty of getting LLM's to generate SQL that is valid across multiple dialects.

- https://news.ycombinator.com/item?id=43812675
- https://cloud.google.com/blog/products/databases/techniques-for-improving-text-to-sql

From the Google Cloud article above:

> Problem #3: Limits of LLM generation
>
> ... But some models can struggle with following precise instructions and getting details exactly right, particularly when it comes to more obscure SQL features. To be able to produce correct SQL, the LLM needs to adhere closely to what can often turn into complex specifications.
>
> Example: Consider the differences between SQL dialects, which are more subtle than differences between programming languages like Python and Java.
> As a simple example, if you're using BigQuery SQL, the correct function for extracting a month from a timestamp column is `EXTRACT(MONTH FROM timestamp_column)`. But if you are using MySQL, you use `MONTH(timestamp_column)`.

# Background

My dayjob and work for the last several years involves this exact problem.

Essentially, I need to preserve and represent the semantics of some particular query across multiple dialects of SQL.

You might think this is a task that can be solved with a few edge-case conditionals, but the reality is that the nuances of behavior and syntax support across dialects are worse than you likely imagine.

I'll discuss an approach that has worked for us, which can be used with LLM's as a generation target to solve this issue.

# Abstract Query AST's

Rather than having code which generates direct SQL, use an IR layer that represents the abstract form of a query.

For example, suppose you have something like:

```sql
SELECT json_agg(
    json_build_object(
    'id', u.id,
    'name', u.name,
    'todos', (
            SELECT json_agg(json_build_object('id', t.id, 'todo', t.todo))
            FROM user_todos t
            WHERE t.user_id = u.id
        )
    )
)
FROM users u;
```

You might have a representation like:

```java
select(jsonArrayAgg(jsonObject(
  "id", field("u", "id"),
  "name", field("u", "name"),
  "todos", select(jsonArrayAgg(jsonObject(
      "id", field("t", "id"),
      "todo", field("t", "todo"))
    ))
    .from("user_todos").as("t")
    .where(field("t", "user_id").eq(field("u", "id")))
)))
.from("users").as("u")
```

And then the query can be rendered/interpreted at runtime into dialect specific SQL like:

```java
var renderedQuery = render(Database.MYSQL, queryAST)
```

Many languages have query-builder libraries which allow you to write statements like the above.

On the JVM, we have [jOOQ](https://github.com/jOOQ/jOOQ), but many similar tools exist in other ecosystems, such as Entity Framework, SQL Alchemy, Kysely, and others.

# Asking an LLM to generate a JSON query for MySQL, Postgres, and Trino

We can ask an LLM to write us an **abstract query** like the one above.

Then we can render this query to multiple dialects and view the output.

For the sake of sharing this online, I will use Scala (sorry) because it's the only JVM language with an online playground that allows importing external libraries (that I know of).

I asked Claude:

https://claude.ai/share/df8b9e6b-c01d-409a-a977-11d35f383741

> Please write Scala 3 code to represent the following Postgres SQL query as a jOOQ DSL `Query`.
> The code should generate a single, inline query and be as succinct as possible.

It output the below:

```scala
import org.jooq.impl.DSL
import org.jooq.impl.DSL._

// Define the tables
val users = table("users").as("u")
val userTodos = table("user_todos").as("t")

// Create the query
val query = select(
  jsonArrayAgg(
    jsonObject(
      key("id").value(field("u.id")),
      key("name").value(field("u.name")),
      key("todos").value(
        select(
          jsonArrayAgg(
            jsonObject(
              key("id").value(field("t.id")),
              key("todo").value(field("t.todo"))
            )
          )
        )
        .from(userTodos)
        .where(field("t.user_id").eq(field("u.id")))
      )
    )
  )
)
.from(users)
```

We can run this online with **Scastie**, and view the output:

https://scastie.scala-lang.org/HMX9awUVRAuAdLdX7PntRA

```scala
import org.jooq.SQLDialect
import org.jooq.conf.Settings

for (dialect <- Seq(SQLDialect.MYSQL, SQLDialect.POSTGRES, SQLDialect.TRINO)) {
    val ctx = DSL.using(dialect, Settings().withRenderFormatted(true))
    println(s"Query in ${dialect.name()}:")
    println(ctx.renderInlined(query))
}
```

Running this in your browser should give you:

<details>

<summary>👇 CLICK TO VIEW OUTPUT 👇</summary>

```
============================
Query in MYSQL:
set @t = @@group_concat_max_len;
set @@group_concat_max_len = 4294967295;
select json_merge_preserve(
  '[]',
  concat(
    '[',
    group_concat(json_object(
      'id', u.id,
      'name', u.name,
      'todos', (
        select json_merge_preserve(
          '[]',
          concat(
            '[',
            group_concat(json_object(
              'id', t.id,
              'todo', t.todo
            ) separator ','),
            ']'
          )
        )
        from user_todos as `t`
        where t.user_id = u.id
      )
    ) separator ','),
    ']'
  )
)
from users as `u`;
set @@group_concat_max_len = @t;

============================
Query in POSTGRES:
select json_agg(json_build_object(
  'id', u.id,
  'name', u.name,
  'todos', (
    select json_agg(json_build_object(
      'id', t.id,
      'todo', t.todo
    ))
    from user_todos as "t"
    where t.user_id = u.id
  )
))
from users as "u"

============================
Query in TRINO:
select cast(array_agg(cast(map_from_entries(array[
  row(
    'id',
    cast(u.id as json)
  ),
  row(
    'name',
    cast(u.name as json)
  ),
  row(
    'todos',
    cast((
      select cast(array_agg(cast(map_from_entries(array[
        row(
          'id',
          cast(t.id as json)
        ),
        row(
          'todo',
          cast(t.todo as json)
        )
      ]) as json)) as json)
      from user_todos "t"
      where t.user_id = u.id
    ) as json)
  )
]) as json)) as json)
from users "u"
```

</details>

> NOTE: The output isn't _100%_ correct because it omits `field(name("t", "user_id"))` to properly handle quoting. But we'll give it a break because realistically you would upload the jOOQ API as reference material in production

# Why the Problem is Non-Trivial

Let's use the above query as one example of why you can't write some home-spun Query Builder API in an afternoon to solve this problem.

You might think, _"Okay, so the syntax for JSON object creation varies between dialects -- I'll just have some interface like:"_

```ts
interface SQLGenerator {
    function jsonObject(fields: Record<string, SQLExpression>): SQLExpression;
    function jsonArrayAgg(expression: SQLExpression): SQLExpression;
}
```

But the problem is not so straightforward. Let's look at two examples that I think saliently illustrate this point:

1.  How to represent the above JSON query in various dialects
2.  How to implement `generate_series()` in various dialects

## NOTE: jOOQ's "Translate" Online Tool

The following syntax derivations were done using the online jOOQ _"Translate"_ tool.

https://www.jooq.org/translate

This tool is highly useful if you need to translate SQL into unfamiliar dialects:

![jooq translate online tool screenshot](/static/images/jooq-translate-tool.png)

## JSON Query

### MariaDB

For some background context, reference the following blogpost by Lukas Eder, jOOQ author:

["Standard SQL/JSON – The Sobering Parts"](https://blog.jooq.org/standard-sql-json-the-sobering-parts/)

The sections on MySQL and MariaDB contain a better description of the various issues than I could give, but for this example the gist of it is:

- `ORDER BY` as part of a JSON expression is not supported, so you've got to use `group_concat` to build the result
- The maximum length of `group_concat`'ed expressions is controlled by a DB variable. Creating a string larger than this value will cause cryptic errors about malformed input from `json_merge_preserve` due to truncation.
- To prevent escaped output when building the JSON, e.g. `{"titles": "[\"1984\",\"Animal Farm\",\"O Alquimista\",\"Brida\"]"}`, you need to call `json_merge_preserve`

```sql
set @t = @@group_concat_max_len;
set @@group_concat_max_len = 4294967295;
select json_merge_preserve(
  '[]',
  concat(
    '[',
    group_concat(json_merge_preserve(
      '{}',
      json_object('id', u.id),
      json_object('name', u.name),
      json_object('todos', json_merge_preserve(
        '[]',
        (
          select json_merge_preserve(
            '[]',
            concat(
              '[',
              group_concat(json_merge_preserve(
                '{}',
                json_object('id', t.id),
                json_object('todo', t.todo)
              ) separator ','),
              ']'
            )
          )
          from user_todos as t
          where t.user_id = u.id
        )
      ))
    ) separator ','),
    ']'
  )
)
from users as u;
set @@group_concat_max_len = @t;
```

### Trino/Presto/Athena

```sql
select cast(array_agg(cast(map_from_entries(array[
  row('id', cast(u.id as json)),
  row('name', cast(u.name as json)),
  row(
    'todos',
    cast((
      select cast(array_agg(cast(map_from_entries(array[
        row('id', cast(t.id as json)),
        row('todo', cast(t.todo as json))
      ]) as json)) as json)
      from user_todos t
      where t.user_id = u.id
    ) as json)
  )
]) as json)) as json)
from users u
```

### SQL Server

```sql
select json_arrayagg((
  select (
    select *
    from (
      values (
        u.id,
        u.name,
        json_query((
          select json_arrayagg((
            select *
            from (
              values (t.id, t.todo)
            ) t ([id], [todo])
            for json path, include_null_values, without_array_wrapper
          ))
          from user_todos t
          where t.user_id = u.id
        ))
      )
    ) t ([id], [name], [todos])
    for json path, include_null_values, without_array_wrapper
  )
))
from users u
```

## Generate Series

Now lets look at the SQL for generating a series of integer values from a given range:

### Postgres

```sql
SELECT i FROM generate_series(1, 10) AS i;
```

### Clickhouse

```sql
select i
from (
  select cast(number as Nullable(integer)) i
  from numbers(1, (10 + 1))
) i
```

### Snowflake

```sql
select i
from (
  select (row_number() over (order by (
    select 1
  )) + (1 - 1)) i
  from table(generator(rowcount => (10 - (1 - 1))))
) i
```

### Oracle

```sql
select i
from (
  select (level + (1 - 1)) i
  from DUAL
  connect by level <= ((10 + 1) - 1)
) i
```

### MySQL

```sql
select i
from (
  with recursive
    i(i) as (
      select 1
      union all
      select (i + 1)
      from i
      where i < 10
    )
  select i
  from i
) as i
```

# Conclusion

I hope this post has given you a sense for how leveraging an abstract Query IR as your SQL generation target can help deal with the complexities of portable, cross-dialect SQL.

It's proven an effective strategy for what I use it for.

> AI Disclaimer: ChatGPT 4.1 was used to generate the Open Graph image for this post.
