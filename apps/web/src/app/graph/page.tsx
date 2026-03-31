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
  isCenter: boolean;
  score?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  score: number;
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
  const [notes, setNotes] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const animationRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);

  useEffect(() => {
    if (user) {
      listRecentNotes(50).then(setNotes).catch(console.error);
    }
  }, [user]);

  const loadGraph = useCallback(async (noteId: string) => {
    setLoading(true);
    setSelectedNote(noteId);
    try {
      const related = await getRelatedNotes(noteId, 12);
      const centerNote = notes.find((n) => n.id === noteId);
      if (!centerNote) return;

      const centerX = 400;
      const centerY = 300;

      const newNodes: GraphNode[] = [
        {
          id: centerNote.id,
          title: centerNote.title,
          x: centerX,
          y: centerY,
          vx: 0,
          vy: 0,
          radius: 32,
          isCenter: true,
        },
      ];

      const newEdges: GraphEdge[] = [];

      related.forEach((r: { id: string; title: string; section_name: string; score: number }, i: number) => {
        const angle = (2 * Math.PI * i) / related.length;
        const dist = 150 + Math.random() * 80;
        newNodes.push({
          id: r.id,
          title: r.title,
          section: r.section_name,
          x: centerX + Math.cos(angle) * dist,
          y: centerY + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          radius: 12 + r.score * 20,
          isCenter: false,
          score: r.score,
        });
        newEdges.push({ source: centerNote.id, target: r.id, score: r.score });
      });

      nodesRef.current = newNodes;
      setGraphNodes(newNodes);
      setGraphEdges(newEdges);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [notes]);

  // Force simulation
  useEffect(() => {
    if (graphNodes.length === 0) return;

    const simulate = () => {
      const nodes = nodesRef.current;
      const centerX = 400;
      const centerY = 300;

      // Apply forces
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        // Center gravity
        if (!node.isCenter) {
          node.vx += (centerX - node.x) * 0.001;
          node.vy += (centerY - node.y) * 0.001;
        }

        // Repulsion between nodes
        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = node.radius + other.radius + 40;
          if (dist < minDist) {
            const force = (minDist - dist) * 0.05;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (!node.isCenter) { node.vx += fx; node.vy += fy; }
            if (!other.isCenter) { other.vx -= fx; other.vy -= fy; }
          }
        }

        // Spring force for connected edges
        graphEdges.forEach((edge) => {
          if (edge.source === node.id || edge.target === node.id) {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const other = nodes.find((n) => n.id === otherId);
            if (!other) return;
            const dx = other.x - node.x;
            const dy = other.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const idealDist = 180;
            const force = (dist - idealDist) * 0.003;
            if (!node.isCenter) {
              node.vx += (dx / dist) * force;
              node.vy += (dy / dist) * force;
            }
          }
        });

        // Damping and position update
        node.vx *= 0.9;
        node.vy *= 0.9;
        if (!node.isCenter) {
          node.x += node.vx;
          node.y += node.vy;
        }
      }

      setGraphNodes([...nodes]);
      animationRef.current = requestAnimationFrame(simulate);
    };

    animationRef.current = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [graphEdges]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw edges
    graphEdges.forEach((edge) => {
      const source = graphNodes.find((n) => n.id === edge.source);
      const target = graphNodes.find((n) => n.id === edge.target);
      if (!source || !target) return;

      const opacity = 0.15 + edge.score * 0.5;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = `rgba(122, 92, 255, ${opacity})`;
      ctx.lineWidth = 1 + edge.score * 2;
      ctx.stroke();
    });

    // Draw nodes
    graphNodes.forEach((node) => {
      const isHovered = hoveredNode === node.id;

      // Glow
      if (node.isCenter || isHovered) {
        const gradient = ctx.createRadialGradient(node.x, node.y, node.radius, node.x, node.y, node.radius * 2.5);
        gradient.addColorStop(0, node.isCenter ? "rgba(122, 92, 255, 0.3)" : "rgba(167, 139, 250, 0.2)");
        gradient.addColorStop(1, "rgba(122, 92, 255, 0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      if (node.isCenter) {
        const gradient = ctx.createLinearGradient(node.x - node.radius, node.y, node.x + node.radius, node.y);
        gradient.addColorStop(0, "#5A3BDF");
        gradient.addColorStop(1, "#A06BFF");
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = isHovered ? "rgba(122, 92, 255, 0.8)" : "rgba(122, 92, 255, 0.4)";
      }
      ctx.fill();
      ctx.strokeStyle = isHovered ? "#a78bfa" : "rgba(167, 139, 250, 0.3)";
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Label
      ctx.font = node.isCenter ? "bold 13px Inter, sans-serif" : "11px Inter, sans-serif";
      ctx.fillStyle = isHovered || node.isCenter ? "#e8e6f0" : "rgba(232, 230, 240, 0.7)";
      ctx.textAlign = "center";
      const label = node.title.length > 22 ? node.title.slice(0, 20) + "…" : node.title;
      ctx.fillText(label, node.x, node.y + node.radius + 16);

      if (node.score && !node.isCenter) {
        ctx.font = "9px Inter, sans-serif";
        ctx.fillStyle = "rgba(167, 139, 250, 0.5)";
        ctx.fillText(`${Math.round(node.score * 100)}%`, node.x, node.y + node.radius + 28);
      }
    });
  }, [graphNodes, hoveredNode]);

  // Mouse interaction
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const found = graphNodes.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 5;
    });
    setHoveredNode(found?.id || null);
    canvas.style.cursor = found ? "pointer" : "default";
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clicked = graphNodes.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 5;
    });

    if (clicked) {
      if (clicked.isCenter) {
        router.push(`/notes/${clicked.id}`);
      } else {
        loadGraph(clicked.id);
      }
    }
  };

  return (
    <div className="max-w-6xl">
      <h2 className="text-2xl font-display font-bold mb-4">Note Graph</h2>
      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Explore connections between your notes. Select a note to see related content.
      </p>

      {/* Note selector */}
      <div className="flex gap-3 mb-6">
        <select
          value={selectedNote || ""}
          onChange={(e) => e.target.value && loadGraph(e.target.value)}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--card-border)',
            color: 'var(--foreground)',
          }}
        >
          <option value="" style={{ background: '#13112e' }}>Select a note to explore...</option>
          {notes.map((n) => (
            <option key={n.id} value={n.id} style={{ background: '#13112e' }}>{n.title}</option>
          ))}
        </select>
      </div>

      {/* Graph canvas */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: 'radial-gradient(circle at center, rgba(122,92,255,0.03) 0%, transparent 70%)',
          border: '1px solid var(--card-border)',
          height: 600,
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'rgba(13,11,36,0.8)' }}>
            <div className="flex items-center gap-3" style={{ color: 'var(--accent)' }}>
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                <path d="M12 2a10 10 0 019.8 8" strokeLinecap="round" />
              </svg>
              Loading connections...
            </div>
          </div>
        )}

        {graphNodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-16 h-16 mb-4 opacity-30" viewBox="0 0 20 20" fill="none" strokeWidth={0.8} stroke="currentColor">
              <circle cx="10" cy="10" r="2.5" />
              <circle cx="4" cy="5" r="1.5" />
              <circle cx="16" cy="5" r="1.5" />
              <circle cx="5" cy="16" r="1.5" />
              <circle cx="16" cy="14" r="1.5" />
              <path d="M8 8.5L5.5 6M12 8.5l2.5-2.5M8.5 12l-2 2.5M12.5 11l2 2" strokeLinecap="round" />
            </svg>
            <p className="text-sm">Select a note above to explore its connections</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%" }}
          onMouseMove={handleCanvasMouseMove}
          onClick={handleCanvasClick}
        />
      </div>

      {/* Legend */}
      {graphNodes.length > 0 && (
        <div className="flex items-center gap-6 mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: 'linear-gradient(to right, #5A3BDF, #A06BFF)' }} />
            <span>Selected note</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(122,92,255,0.4)' }} />
            <span>Related note (click to explore)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5" style={{ background: 'rgba(122,92,255,0.4)' }} />
            <span>Similarity (thicker = stronger)</span>
          </div>
        </div>
      )}
    </div>
  );
}
