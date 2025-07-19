---
title: 'Experimenting with SQL:2023 Property-Graph Queries in Postgres 18'
date: '2025-07-19'
tags: ['postgres', 'sql']
draft: false
summary: 'Hands-on guide to the upcoming SQL/PGQ graph syntax using a patched Postgres 18 beta.'
images: ['/static/images/postgres-sql-pgq-banner.png']
---

<TOCInline toc={props.toc} indentDepth={4} asDisclosure />

---

**TL;DR**  
Grab the Docker image below, connect with `psql`, and try the recommendation-graph query. SQL/PGQ feels like Cypher without leaving home.

# Intro

SQL:2023 introduced a new syntax for graph querying.

This graph query language is called "SQL/PGQ". You can read more about it below:

- https://www.iso.org/standard/79473.html
- https://www.postgresql.org/message-id/a855795d-e697-4fa5-8698-d20122126567%40eisentraut.org
- https://blogs.oracle.com/database/post/property-graphs-in-oracle-database-23ai-the-sql-pgq-standard

To date, only Oracle 23 has released support for it, but I want to show you how you can experiment with SQL/PGQ today in Postgres.

# Docker Image with Postgres 18beta2 + SQL/PGQ Patches

I've published a Docker image which contains the latest release of Postgres and applies the SQL/PGQ patches from the mailing list.

```sh
docker run -d \
  --name postgres-pgq \
  -p 5432:5432 \
  -v postgres-data:/var/lib/postgresql/data \
  -e PGDATA=/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=postgres \
  gavinray/postgres-18beta2-pgql:latest

docker exec -it postgres-pgq psql -U postgres -d postgres
```

You can find the source below. Please excuse the Cthonian horror that is the `Dockerfile`.
https://github.com/GavinRay97/postgres-18beta2-sql-pgl

# Example: E-Commerce Product Recommendations

This example has been done to death, but it's a good way to showcase PGQ.

Suppose we've got `users`, a list of `products`, and `purchases`:

```sql
-- Node Table: Users
CREATE TABLE users (
    id INT GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL
);

-- Node Table: Products
CREATE TABLE products (
    id INT GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2)
);

-- Edge Table: Purchases linking users and products
CREATE TABLE purchases (
    user_id INT REFERENCES users(id),
    product_id INT REFERENCES products(id),
    purchase_date DATE DEFAULT CURRENT_DATE,
    PRIMARY KEY (user_id, product_id)
);
```

And suppose that we have `Alice` and `Bob`.
`Alice` buys a laptop and a mouse, `Bob` buys a laptop and a keyboard:

```sql
INSERT INTO
    users (name)
VALUES
    ('Alice'), -- id 1
    ('Bob'); -- id 2

INSERT INTO
    products (name, price)
VALUES
    ('Laptop', 1200.00), -- id 1
    ('Mouse', 25.00), -- id 2
    ('Keyboard', 75.00); -- id 3

-- Insert purchases (edges)
INSERT INTO
    purchases (user_id, product_id)
VALUES
    (1, 1), -- Alice bought a Laptop
    (1, 2), -- Alice bought a Mouse
    (2, 1), -- Bob bought a Laptop (the shared item)
    (2, 3); -- Bob bought a Keyboard (the recommendation)
```

Now we can get into the meat of things: the Property Graph definition and a query over it.

We start by defining a `PROPERTY GRAPH`, and declaring `VERTEX` and `EDGE` tables for it.
The documentation for this DDL statement can be found at:

- https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/create-property-graph.html

```sql
CREATE PROPERTY GRAPH recommender_graph
VERTEX TABLES (
    users LABEL users PROPERTIES (id, name),
    products LABEL product PROPERTIES (id, name, price)
)
EDGE TABLES (
    purchases
    SOURCE KEY (user_id) REFERENCES users (id)
    DESTINATION KEY (product_id) REFERENCES products (id)
    LABEL BOUGHT
);
```

![graphviz image of user purchases](/static/images/product-purchase-graph.svg)

Now, we can ask a question like: "What are similar products that Alice hasn't yet purchased?"

The syntax for that statement in PGQL (well, one representation of it), is:

```sql
-- (Alice) -> (Shared Product) <- (Similar User) -> (Recommended Product)
SELECT DISTINCT g.rec_id, g.rec_name
FROM GRAPH_TABLE (
       recommender_graph
       MATCH   (me  IS users    WHERE me.name = 'Alice')
               -[:BOUGHT]->(p   IS product)<-[:BOUGHT]-(sim IS users)
               -[:BOUGHT]->(rec IS product)
       COLUMNS (me.id  AS uid,
                rec.id AS rec_id,
                rec.name AS rec_name)
) AS g
WHERE NOT EXISTS (
        SELECT 1
        FROM   purchases p
        WHERE  p.user_id    = g.uid
          AND  p.product_id = g.rec_id
);
```

That should return:

```md
| Rec id | Rec name |
| :----- | :------- |
| 3      | Keyboard |
```

It seems that `Alice`, having purchased a laptop and a mouse, might appreciate a keyboard!
Neat.

# Patch and Build Details

This image was built by applying the most recent collection of patches supplied in the mailing list thread from Junwang Zhao on top of the `18beta2` source tarzip.

- https://www.postgresql.org/message-id/CAEG8a3L3uZZRT5Ra5%3D9G-SOCEYULejw5eqQE99VL0YfTeX3-BA%40mail.gmail.com

```
Attachment	Content-Type	Size
v10-0011-do-not-use-default-COLLATE.patch	application/octet-stream	5.8 KB
v10-0012-trivial-refactor-of-property-graph-object-addres.patch	application/octet-stream	17.1 KB
v10-0010-adapt-property-graph-to-more-intuitive-titles.patch	application/octet-stream	2.6 KB
v10-0008-Document-fixes.patch	application/octet-stream	5.1 KB
v10-0009-WIP-Do-not-print-empty-columns-table-for-a-prope.patch	application/octet-stream	14.1 KB
v10-0007-RLS-tests.patch	application/octet-stream	182.1 KB
v10-0006-Property-collation-and-edge-vertex-link-support.patch	application/octet-stream	114.3 KB
v10-0005-Access-permissions-on-property-graph.patch	application/octet-stream	11.9 KB
v10-0004-Fixes-following-issues.patch	application/octet-stream	36.2 KB
v10-0003-Support-cyclic-path-pattern.patch	application/octet-stream	37.4 KB
v10-0002-support-WHERE-clause-in-graph-pattern.patch	application/octet-stream	7.2 KB
v10-0001-WIP-SQL-Property-Graph-Queries-SQL-PGQ.patch	application/octet-stream	504.4 KB
```

Additionally, there are some hacky patches in the Dockerfile that strip out a bunch of functionality related to Serbian locale and stemming, to fix compilation errors.

# Further Reading

- https://pgconf.in/conferences/pgconfin2025/program/proposals/895
- https://www.enterprisedb.com/blog/representing-graphs-postgresql-sqlpgq

# Conclusion

I don't often work in domains that can benefit from the ergonomic enhancements that Property Graphs can provide, but I think it's an invaluable addition to the ISO SQL Standard.

Looking forward to the day this gets merged in Postgres =)
