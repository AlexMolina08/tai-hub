/** Fenced examples are text nodes, never executable markup from a private package. */
export function StudyText({ text }: { text: string }) {
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?\n```)/g).filter(block => block.trim())
  return <div className="lab-study-text">{blocks.map((block, index) => {
    const code = /^```([^\n]*)\n([\s\S]*?)\n```$/.exec(block)
    return code
      ? <figure className="lab-code-example" key={index}>
        {code[1].trim() && <figcaption>{code[1].trim()}</figcaption>}
        <pre><code>{code[2]}</code></pre>
      </figure>
      : block.trim().split(/\n[\t ]*\n+/).map((paragraph, part) => <p key={`${index}:${part}`}>{paragraph}</p>)
  })}</div>
}
