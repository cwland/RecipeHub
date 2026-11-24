import type { ReactNode } from "react";

// A chat reply as the AI wrote it, with a little markdown: paragraphs, "-" / "*" bullets, "1." lists,
// **bold** and *italic*. Everything is plain React text, so nothing in a reply can run as HTML.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    const last = out[out.length - 1];
    const bullet = t.match(/^[-*•]\s+(.*)$/);
    const number = t.match(/^\d+[.)]\s+(.*)$/);
    if (!t) out.push({ kind: "p", lines: [] });
    else if (bullet) last?.kind === "ul" ? last.items.push(bullet[1]) : out.push({ kind: "ul", items: [bullet[1]] });
    else if (number) last?.kind === "ol" ? last.items.push(number[1]) : out.push({ kind: "ol", items: [number[1]] });
    else if (last?.kind === "p") last.lines.push(t);
    else out.push({ kind: "p", lines: [t] });
  }
  return out.filter((b) => (b.kind === "p" ? b.lines.length : b.items.length));
}

export default function ChatText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {blocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.lines.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l)] : inline(l)))}</p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}
