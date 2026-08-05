import { Streamdown, type Components } from "streamdown";
import remarkGfm from "remark-gfm";

// Streamdown (not react-markdown) specifically so this can render safely
// WHILE the message is still streaming: mode="streaming" tolerates
// incomplete/unclosed syntax (an unclosed **bold, a table missing its
// separator row) without flickering, and it block-memoizes so it doesn't
// re-parse the whole growing string on every paced-reveal tick — a plain
// react-markdown re-parse at that frequency would reintroduce the exact
// "buffering until syntax is valid" jank the streaming rework fixed.
const components: Components = {
  h1: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-bold text-ink first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-bold text-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-[13.5px] font-bold text-ink first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 text-[13.5px] leading-relaxed text-neutral-700 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 text-[13.5px] text-neutral-700">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 text-[13.5px] text-neutral-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-3 border-neutral-200" />,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-700">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-neutral-100 p-3 font-mono text-[12px] text-neutral-700">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-100">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-neutral-200 px-2 py-1 text-left font-semibold text-neutral-600">{children}</th>
  ),
  td: ({ children }) => <td className="border border-neutral-200 px-2 py-1 text-neutral-700">{children}</td>,
};

export function MarkdownContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <div className="w-full">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        remarkPlugins={[remarkGfm]}
        components={components}
        controls={false}
        animated={false}
      >
        {content}
      </Streamdown>
    </div>
  );
}
