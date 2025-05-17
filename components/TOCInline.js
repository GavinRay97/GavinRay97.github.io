const TOCInline = ({
  toc,
  indentDepth = 3,
  fromHeading = 1,
  toHeading = 6,
  asDisclosure = false,
  exclude = '',
}) => {
  const re = Array.isArray(exclude)
    ? new RegExp('^(' + exclude.join('|') + ')$', 'i')
    : new RegExp('^(' + exclude + ')$', 'i')

  const filteredToc = toc.filter(
    (heading) =>
      heading.depth >= fromHeading && heading.depth <= toHeading && !re.test(heading.value)
  )

  function buildTree(toc, depth = fromHeading) {
    const items = []
    let i = 0
    while (i < toc.length) {
      const current = toc[i]
      if (current.depth === depth) {
        // Find children
        const children = []
        let j = i + 1
        while (j < toc.length && toc[j].depth > depth) {
          children.push(toc[j])
          j++
        }
        items.push({
          heading: current,
          children: buildTree(children, depth + 1),
        })
        i = j
      } else {
        i++
      }
    }
    return items
  }

  function renderTree(tree, baseDepth = fromHeading) {
    if (!tree.length) return null
    return (
      <ul>
        {tree.map((node) => {
          const ml = (node.heading.depth - baseDepth) * 24 // 1.5rem per level
          return (
            <li key={node.heading.value} style={{ marginLeft: ml > 0 ? `${ml}px` : undefined }}>
              <a href={node.heading.url}>{node.heading.value}</a>
              {renderTree(node.children, baseDepth)}
            </li>
          )
        })}
      </ul>
    )
  }

  const tocTree = buildTree(filteredToc)

  const tocList = renderTree(tocTree)

  return (
    <>
      {asDisclosure ? (
        <details open>
          <summary className="ml-6 pb-2 pt-2 text-xl font-bold">Table of Contents</summary>
          <div className="ml-6">{tocList}</div>
        </details>
      ) : (
        tocList
      )}
    </>
  )
}

export default TOCInline
