"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

// Atlas Note dark theme matching the app's CSS variables
const atlasNoteTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.9)",
    fontSize: "14px",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0 0 12px 12px",
    border: "1px solid rgba(255,255,255,0.06)",
    borderTop: "none",
  },
  ".cm-content": {
    padding: "16px",
    caretColor: "#7A5CFF",
    minHeight: "400px",
  },
  "&.cm-focused": {
    outline: "2px solid rgba(122,92,255,0.5)",
    outlineOffset: "-1px",
  },
  ".cm-cursor": {
    borderLeftColor: "#7A5CFF",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(122,92,255,0.3) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  ".cm-gutters": {
    display: "none",
  },
  // Markdown syntax highlighting
  ".cm-header-1": { fontSize: "1.5em", fontWeight: "bold", color: "#c4b5fd" },
  ".cm-header-2": { fontSize: "1.3em", fontWeight: "bold", color: "#c4b5fd" },
  ".cm-header-3": { fontSize: "1.1em", fontWeight: "bold", color: "#c4b5fd" },
  ".cm-strong": { fontWeight: "bold", color: "#e0d7ff" },
  ".cm-em": { fontStyle: "italic", color: "#d4bfff" },
  ".cm-link": { color: "#7A5CFF", textDecoration: "underline" },
  ".cm-url": { color: "rgba(122,92,255,0.6)" },
  ".cm-meta": { color: "rgba(255,255,255,0.4)" },
  ".cm-comment": { color: "rgba(255,255,255,0.3)" },
  ".cm-monospace": {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: "3px",
    padding: "1px 4px",
  },
  // Scrollbar
  ".cm-scroller": {
    overflow: "auto",
    maxHeight: "60vh",
  },
  ".cm-scroller::-webkit-scrollbar": {
    width: "6px",
  },
  ".cm-scroller::-webkit-scrollbar-track": {
    background: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "rgba(255,255,255,0.15)",
    borderRadius: "3px",
  },
});

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showToolbar?: boolean;
  onFormatAI?: () => void;
  formattingAI?: boolean;
}

const TOOLBAR_BUTTONS = [
  { label: "B", title: "Bold", before: "**", after: "**" },
  { label: "I", title: "Italic", before: "*", after: "*" },
  { label: "H", title: "Heading", before: "## ", after: "" },
  { label: "•", title: "Bullet List", before: "- ", after: "" },
  { label: "1.", title: "Ordered List", before: "1. ", after: "" },
  { label: "<>", title: "Code", before: "`", after: "`" },
  { label: "🔗", title: "Link", before: "[", after: "](url)" },
  { label: "❝", title: "Quote", before: "> ", after: "" },
  { label: "—", title: "Horizontal Rule", before: "\n---\n", after: "" },
];

export function MarkdownEditor({ value, onChange, placeholder, showToolbar = true, onFormatAI, formattingAI }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [showMdHelp, setShowMdHelp] = useState(false);

  // Sync external value changes
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        atlasNoteTheme,
        cmPlaceholder(placeholder || "Write in markdown..."),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            isInternalChange.current = true;
            onChangeRef.current(update.state.doc.toString());
            isInternalChange.current = false;
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // Only create once

  // Update content if external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isInternalChange.current) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== value) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: value },
      });
    }
  }, [value]);

  const insertMarkdown = useCallback((before: string, after: string) => {
    const view = viewRef.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const insert = `${before}${selected || "text"}${after}`;

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length, head: from + before.length + (selected || "text").length },
    });
    view.focus();
  }, []);

  return (
    <div className="markdown-editor">
      {showToolbar && (
        <>
          <div
            className="flex items-center gap-1 flex-wrap px-3 py-2"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderBottom: "none",
              borderRadius: "12px 12px 0 0",
            }}
          >
            {TOOLBAR_BUTTONS.map((btn) => (
              <button
                key={btn.title}
                onClick={() => insertMarkdown(btn.before, btn.after)}
                title={btn.title}
                className="px-2 py-1 text-xs font-mono rounded transition-colors"
                style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.04)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.color = "var(--foreground)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
                type="button"
              >
                {btn.label}
              </button>
            ))}

            <div className="flex-1" />

            {onFormatAI && (
              <button
                onClick={onFormatAI}
                disabled={formattingAI}
                className="px-2.5 py-1 text-xs font-medium rounded transition-colors"
                style={{ background: "rgba(122,92,255,0.15)", color: "#a78bfa" }}
                onMouseEnter={(e) => { if (!formattingAI) e.currentTarget.style.background = "rgba(122,92,255,0.25)"; }}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(122,92,255,0.15)"}
                type="button"
              >
                {formattingAI ? "Formatting..." : "✨ Format with AI"}
              </button>
            )}

            <button
              onClick={() => setShowMdHelp(!showMdHelp)}
              title="Markdown Help"
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              type="button"
            >
              ?
            </button>
          </div>

          {showMdHelp && (
            <div
              className="px-3 py-2 text-xs font-mono space-y-1"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderTop: "none",
                borderBottom: "none",
                color: "var(--text-secondary)",
              }}
            >
              <div><strong style={{ color: "var(--foreground)" }}>Markdown Cheat Sheet</strong></div>
              <div># Heading 1 &nbsp;&nbsp; ## Heading 2 &nbsp;&nbsp; ### Heading 3</div>
              <div>**bold** &nbsp;&nbsp; *italic* &nbsp;&nbsp; ~~strikethrough~~</div>
              <div>- bullet list &nbsp;&nbsp; 1. numbered list</div>
              <div>`inline code` &nbsp;&nbsp; ```code block```</div>
              <div>[link text](url) &nbsp;&nbsp; ![image](url)</div>
              <div>&gt; blockquote &nbsp;&nbsp; --- horizontal rule</div>
            </div>
          )}
        </>
      )}
      <div ref={containerRef} />
    </div>
  );
}
