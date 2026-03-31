"use client";

import { useEffect, useRef, useCallback } from "react";
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
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.06)",
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
}

export function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

  return <div ref={containerRef} className="markdown-editor" />;
}
