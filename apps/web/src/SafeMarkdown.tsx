import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Generated text cannot create executable HTML, outgoing links or tracking image requests. */
export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
