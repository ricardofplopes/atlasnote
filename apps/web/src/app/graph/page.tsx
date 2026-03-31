"use client";

import { AppShell } from "@/components/app-shell";
import { useEffect, useState, useRef, useCallback } from "react";
import { listRecentNotes, getRelatedNotes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

interface GraphNode {
  id: string;
  title: string;
  section?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface GraphEdge {
  source: string;
  target: string;
  score: number;
}

const SECTION_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  "#7A5CFF", "#FF6B9D", "#00D4AA", "#FFB347",
  "#45B7D1", "#FF6F61", "#98D8C8", "#C4A1FF",
  "#F7DC6F", "#82E0AA", "#85C1E9", "#F1948A",
];
let colorIdx = 0;

function getSectionColor(section: string): string {
  if (!SECTION_COLORS[section]) {
    SECTION_COLORS[section] = COLOR_PALETTE[colorIdx % COLOR_PALETTE.length];
    colorIdx++;
  }
  return SECTION_COLORS[section];
}

export default function GraphPage() {
  return (
    <AppShell>
      <GraphContent />
    </AppShell>
  );
}

function GraphContent() {
  const { user } = useAuth();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Pan & zoom state
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const draggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const animRef = useRef<number>(0);

  const loadAllNotes = useCallback(async () => {
    setLoading(true);
    try {
      const allNotes = await listRecentNotes(100);
      if (!allNotes || allNotes.length === 0) {
        setLoading(false);
        return;
      }

      const canvas = canvasRef.current;
      const w = canvas?.clientWidth || 800;
      const h = canvas?.clientHeight || 600;
      const cx = w / 2;
      const cy = h / 2;

      // Position notes in a spiral layout
      const nodes: GraphNode[] = allNotes.map((n: any, i: number) => {
        const angle = i * 0.8;
        const r = 50 + i * 12;
        return {
          id: n.id,
          title: n.title,
          section: n.section_id,
          x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30,
          y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
          radius: 8,
        };
      });
      nodesRef.current = nodes;

      // Fetch relationships for all notes (batch)
      const allEdges: GraphEdge[] = [];
      const batchSize = 5;
      for (let i = 0; i < Math.min(nodes.length, 30); i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((n) => getRelatedNotes(n.id, 5).catch(() => []))
        );
        for (let j = 0; j < batch.length; j++) {
          for (const rel of results[j]) {
            if (nodes.some((n) => n.id === rel.id)) {
              const exists = allEdges.some(
                (e) => (e.source === batch[j].id && e.target === rel.id) ||
                       (e.source === rel.id && e.target === batch[j].id)
              );
              if (!exists) {
                allEdges.push({ source: batch[j].id, target: rel.id, score: rel.score });
                // Update section color
                const targetNode = nodes.find((n) => n.id === rel.id);
                if (targetNode && rel.section_name) {
                  targetNode.section = rel.section_name;
                }
              }
            }
          }
        }
      }
      edgesRef.current = allEdges;
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadAllNotes();
  }, [user, loadAllNotes]);

  // Physics simulation
  useEffect(() => {
    let running = true;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    const simulate = () => {
      if (!running || nodes.length === 0) return;

      // Node repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      // Edge attraction
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const targetDist = 120;
        const force = (dist - targetDist) * 0.01 * edge.score;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }

      // Apply velocity with damping
      for (const node of nodes) {
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
      }
    };

    const tick = () => {
      simulate();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [loading]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frameId = 0;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      // Draw edges
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(122,92,255,${0.1 + edge.score * 0.3})`;
        ctx.lineWidth = 0.5 + edge.score;
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        const isHovered = hoveredNode === node.id;
        const isSelected = selectedNode?.id === node.id;
        const r = node.radius * (isHovered || isSelected ? 1.4 : 1);

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        const color = node.section ? getSectionColor(node.section) : "#7A5CFF";
        ctx.fillStyle = isSelected ? "#fff" : color;
        ctx.fill();

        if (isHovered || isSelected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Label
        if (isHovered || isSelected || zoomRef.current > 0.7) {
          ctx.font = `${isHovered || isSelected ? "bold " : ""}11px Inter, sans-serif`;
          ctx.fillStyle = isHovered || isSelected ? "#fff" : "rgba(255,255,255,0.6)";
          ctx.textAlign = "center";
          const label = node.title.length > 25 ? node.title.slice(0, 22) + "..." : node.title;
          ctx.fillText(label, node.x, node.y + r + 14);
        }
      }

      ctx.restore();

      // Legend
      const sections = [...new Set(nodes.map((n) => n.section).filter(Boolean))];
      ctx.font = "11px Inter, sans-serif";
      let ly = 20;
      for (const sec of sections.slice(0, 8)) {
        if (!sec) continue;
        ctx.fillStyle = getSectionColor(sec);
        ctx.beginPath();
        ctx.arc(w - 120, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.textAlign = "left";
        const secLabel = sec.length > 12 ? sec.slice(0, 10) + ".." : sec;
        ctx.fillText(secLabel, w - 110, ly + 4);
        ly += 18;
      }

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, [loading, hoveredNode, selectedNode]);

  // Mouse handlers for pan/zoom/hover/click
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - panRef.current.x) / zoomRef.current,
      y: (sy - panRef.current.y) / zoomRef.current,
    });

    const findNode = (sx: number, sy: number) => {
      const { x, y } = screenToWorld(sx, sy);
      return nodesRef.current.find(
        (n) => Math.hypot(x - n.x, y - n.y) < n.radius * 1.5
      );
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.2, Math.min(3, zoomRef.current * factor));

      panRef.current.x = mx - (mx - panRef.current.x) * (newZoom / zoomRef.current);
      panRef.current.y = my - (my - panRef.current.y) * (newZoom / zoomRef.current);
      zoomRef.current = newZoom;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = findNode(mx, my);
      if (node) {
        setSelectedNode(node);
      } else {
        draggingRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (draggingRef.current) {
        panRef.current.x += e.clientX - lastMouseRef.current.x;
        panRef.current.y += e.clientY - lastMouseRef.current.y;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      const node = findNode(mx, my);
      setHoveredNode(node?.id || null);
      canvas.style.cursor = node ? "pointer" : "grab";
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
    };

    const handleDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = findNode(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        router.push(`/notes/${node.id}`);
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("dblclick", handleDblClick);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("dblclick", handleDblClick);
    };
  }, [router]);

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-display font-bold">Knowledge Graph</h2>
        <div className="flex items-center gap-3">
          {selectedNode && (
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {selectedNode.title}
              </span>
              <button
                onClick={() => router.push(`/notes/${selectedNode.id}`)}
                className="text-xs px-3 py-1 rounded-lg font-medium"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                Open
              </button>
            </div>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Scroll to zoom · Drag to pan · Click to select · Double-click to open
          </span>
        </div>
      </div>

      <div className="flex-1 rounded-xl overflow-hidden relative" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 mx-auto mb-3" style={{ border: "2px solid var(--card-border)", borderTopColor: "var(--accent)", borderRadius: "50%" }} />
              <p style={{ color: "var(--text-muted)" }}>Building knowledge graph...</p>
            </div>
          </div>
        ) : (
          <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: "grab" }} />
        )}
      </div>
    </div>
  );
}
