import React, { ReactNode } from "react";
import remarkGfm from "remark-gfm";
import Link from "next/link";

export const remarkPlugins = [remarkGfm];

function processWikiLinks(text: string): (string | React.ReactElement)[] {
  const parts = text.split(/(\[\[.+?\]\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[\[(.+?)\]\]$/);
    if (match) {
      const title = match[1];
      return (
        <Link
          key={i}
          href={`/search?q=${encodeURIComponent(title)}`}
          style={{
            color: "var(--accent)",
            textDecoration: "underline",
            textDecorationStyle: "dotted" as const,
            textUnderlineOffset: "2px",
          }}
        >
          {title}
        </Link>
      );
    }
    return part;
  });
}

function processChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    if (children.includes("[[")) {
      return processWikiLinks(children);
    }
    return children;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string" && child.includes("[[")) {
        return <React.Fragment key={i}>{processWikiLinks(child)}</React.Fragment>;
      }
      if (React.isValidElement(child)) {
        const el = child as React.ReactElement<{ children?: ReactNode }>;
        if (el.props.children) {
          return React.cloneElement(el, { key: i } as Record<string, unknown>, processChildren(el.props.children));
        }
      }
      return child;
    });
  }
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: ReactNode }>;
    if (el.props.children) {
      return React.cloneElement(el, {} as Record<string, unknown>, processChildren(el.props.children));
    }
  }
  return children;
}

export const markdownComponents = {
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "2px" }}
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{processChildren(children)}</p>
  ),
  li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li {...props}>{processChildren(children)}</li>
  ),
  td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props}>{processChildren(children)}</td>
  ),
  th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th {...props}>{processChildren(children)}</th>
  ),
};
