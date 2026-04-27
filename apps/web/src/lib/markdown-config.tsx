import React from "react";
import remarkGfm from "remark-gfm";

export const remarkPlugins = [remarkGfm];

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
};
