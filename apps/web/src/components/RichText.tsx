function renderInline(text: string) {
  const parts = text.split("`");
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="md-inline">
        {part}
      </code>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function RichText({ text }: { text: string }) {
  const chunks = text.split("```");
  return (
    <div className="rich">
      {chunks.map((chunk, index) => {
        if (index % 2 === 1) {
          const newline = chunk.indexOf("\n");
          const body = newline === -1 ? chunk : chunk.slice(newline + 1);
          return (
            <pre key={index} className="md-code">
              <code>{body.replace(/\n$/, "")}</code>
            </pre>
          );
        }
        if (!chunk) return null;
        return (
          <div key={index} className="md-text">
            {renderInline(chunk)}
          </div>
        );
      })}
    </div>
  );
}
