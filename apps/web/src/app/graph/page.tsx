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
  connections: number;
}

interface GraphEdge {
  source: string;
  target: string;
  score: number;
}

interface GraphStats {
  totalNotes: number;
  totalConnections: number;
  sectionCount: number;
  mostConnectedNote: string;
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

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<GraphStats>({
    totalNotes: 0, totalConnections: 0, sectionCount: 0, mostConnectedNote: "",
  });
  const [sections, setSections] = useState<string[]>([]);
  const [topConnected, setTopConnected] = useState<GraphNode[]>([]);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);

  // Refs for canvas to read filter state each frame without effect restarts
  const searchRef = useRef("");
  const selectedSectionsRef = useRef<Set<string>>(new Set());
  useEffect(() => { searchRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { selectedSectionsRef.current = selectedSections; }, [selectedSections]);

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

      // Group notes by section for clustered initial layout
      const sectionCounts = new Map<string, number>();
      for (const n of allNotes) {
        const sec = n.section_id || "__none__";
        sectionCounts.set(sec, (sectionCounts.get(sec) || 0) + 1);
      }

      const sectionKeys = [...sectionCounts.keys()];
      const sectionPositions = new Map<string, { x: number; y: number }>();
      const clusterRadius = Math.min(w, h) * 0.25;
      sectionKeys.forEach((sec, i) => {
        const angle = (i / sectionKeys.length) * Math.PI * 2;
        sectionPositions.set(sec, {
          x: cx + Math.cos(angle) * clusterRadius,
          y: cy + Math.sin(angle) * clusterRadius,
        });
      });

      const nodes: GraphNode[] = allNotes.map((n: Record<string, string>) => {
        const sec = n.section_id || "__none__";
        const center = sectionPositions.get(sec)!;
        const spread = 60 + Math.sqrt(sectionCounts.get(sec) || 1) * 15;
        return {
          id: n.id,
          title: n.title,
          section: n.section_id,
          x: center.x + (Math.random() - 0.5) * spread,
          y: center.y + (Math.random() - 0.5) * spread,
          vx: 0,
          vy: 0,
          radius: 6,
          connections: 0,
        };
      });
      nodesRef.current = nodes;

      // Fetch relationships for ALL notes (no cap)
      const allEdges: GraphEdge[] = [];
      const batchSize = 5;
      for (let i = 0; i < nodes.length; i += batchSize) {
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

      // Dynamic node sizing based on connection count
      const connCounts = new Map<string, number>();
      for (const edge of allEdges) {
        connCounts.set(edge.source, (connCounts.get(edge.source) || 0) + 1);
        connCounts.set(edge.target, (connCounts.get(edge.target) || 0) + 1);
      }
      for (const node of nodes) {
        node.connections = connCounts.get(node.id) || 0;
        node.radius = Math.min(6 + node.connections * 2, 20);
      }

      // Compute stats and derived state
      const uniqueSections = [...new Set(
        nodes.map((n) => n.section).filter(Boolean),
      )] as string[];
      let mostConnected = nodes[0];
      for (const n of nodes) {
        if (n.connections > mostConnected.connections) mostConnected = n;
      }

      setStats({
        totalNotes: nodes.length,
        totalConnections: allEdges.length,
        sectionCount: uniqueSections.length,
        mostConnectedNote: mostConnected?.title || "",
      });
      setSections(uniqueSections);
      setTopConnected(
        [...nodes].sort((a, b) => b.connections - a.connections).slice(0, 10),
      );

      // Center graph on load
      if (nodes.length > 0) {
        let sumX = 0, sumY = 0;
        for (const n of nodes) { sumX += n.x; sumY += n.y; }
        const comX = sumX / nodes.length;
        const comY = sumY / nodes.length;
        const cw = canvas?.clientWidth || 800;
        const ch = canvas?.clientHeight || 600;
        panRef.current = {
          x: cw / 2 - comX * zoomRef.current,
          y: ch / 2 - comY * zoomRef.current,
        };
      }

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
      const query = searchRef.current.toLowerCase();
      const activeSections = selectedSectionsRef.current;
      const hasFilter = query.length > 0 || activeSections.size > 0;

      const isHighlighted = (node: GraphNode) => {
        if (!hasFilter) return true;
        const matchSearch = query.length === 0 || node.title.toLowerCase().includes(query);
        const matchSection = activeSections.size === 0 || !!(node.section && activeSections.has(node.section));
        return matchSearch && matchSection;
      };

      // Draw edges
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const edgeLit = isHighlighted(a) && isHighlighted(b);
        const baseAlpha = 0.1 + edge.score * 0.3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(122,92,255,${hasFilter && !edgeLit ? baseAlpha * 0.12 : baseAlpha})`;
        ctx.lineWidth = 0.5 + edge.score;
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        const isHovered = hoveredNode === node.id;
        const isSelected = selectedNode?.id === node.id;
        const highlighted = isHighlighted(node);
        const dimmed = hasFilter && !highlighted;
        const r = node.radius * (isHovered || isSelected ? 1.4 : 1);

        ctx.globalAlpha = dimmed ? 0.12 : 1;
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
        if (!dimmed && (isHovered || isSelected || zoomRef.current > 0.7)) {
          ctx.font = `${isHovered || isSelected ? "bold " : ""}11px Inter, sans-serif`;
          ctx.fillStyle = isHovered || isSelected ? "#fff" : "rgba(255,255,255,0.6)";
          ctx.textAlign = "center";
          const label = node.title.length > 25 ? node.title.slice(0, 22) + "..." : node.title;
          ctx.fillText(label, node.x, node.y + r + 14);
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();
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

  const toggleSection = (sec: string) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec);
      else next.add(sec);
      return next;
    });
  };

  const highlightNodeInGraph = (node: GraphNode) => {
    setSelectedNode(node);
    const canvas = canvasRef.current;
    if (canvas) {
      panRef.current = {
        x: canvas.clientWidth / 2 - node.x * zoomRef.current,
        y: canvas.clientHeight / 2 - node.y * zoomRef.current,
      };
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
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

      {/* Stats bar */}
      {!loading && (
        <div className="flex gap-3">
          {[
            { label: "Notes", value: stats.totalNotes },
            { label: "Connections", value: stats.totalConnections },
            { label: "Sections", value: stats.sectionCount },
          ].map((s) => (
            <div
              key={s.label}
              className="px-4 py-2 rounded-lg text-xs"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>{s.label}</span>
              <span className="ml-2 font-semibold" style={{ color: "var(--foreground)" }}>
                {s.value.toLocaleString()}
              </span>
            </div>
          ))}
          <div
            className="px-4 py-2 rounded-lg text-xs flex items-center gap-2"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <span style={{ color: "var(--text-muted)" }}>Most Connected</span>
            <span className="font-semibold truncate max-w-[160px]" style={{ color: "var(--foreground)" }}>
              {stats.mostConnectedNote || "—"}
            </span>
          </div>
        </div>
      )}

      {/* Section filter chips + Search */}
      {!loading && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <input
              type="text"
              placeholder="Search notes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
              className="text-xs px-3 py-1.5 rounded-lg outline-none"
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
                width: 180,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            )}
          </div>

          <div className="w-px h-5 mx-1" style={{ background: "var(--card-border)" }} />

          {sections.map((sec) => (
            <button
              key={sec}
              onClick={() => toggleSection(sec)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors"
              style={{
                background: selectedSections.has(sec) ? "var(--accent-soft)" : "var(--card-bg)",
                border: `1px solid ${selectedSections.has(sec) ? "var(--accent)" : "var(--card-border)"}`,
                color: selectedSections.has(sec) ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: getSectionColor(sec) }}
              />
              {sec.length > 14 ? sec.slice(0, 12) + "…" : sec}
            </button>
          ))}
        </div>
      )}

      {/* Main content: graph + side panel */}
      <div className="flex flex-1 gap-2 min-h-0">
        <div
          className="flex-1 rounded-xl overflow-hidden relative"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div
                  className="animate-spin w-8 h-8 mx-auto mb-3"
                  style={{
                    border: "2px solid var(--card-border)",
                    borderTopColor: "var(--accent)",
                    borderRadius: "50%",
                  }}
                />
                <p style={{ color: "var(--text-muted)" }}>Building knowledge graph...</p>
              </div>
            </div>
          ) : (
            <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: "grab" }} />
          )}
        </div>

        {/* Side panel — Most Connected Notes */}
        {!loading && (
          <div
            className="rounded-xl flex flex-col overflow-hidden"
            style={{
              width: sidePanelOpen ? 240 : 40,
              minWidth: sidePanelOpen ? 240 : 40,
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              transition: "width 0.2s, min-width 0.2s",
            }}
          >
            <div
              className="flex items-center px-3 py-2"
              style={{ borderBottom: "1px solid var(--card-border)" }}
            >
              {sidePanelOpen && (
                <span className="text-xs font-semibold flex-1" style={{ color: "var(--text-secondary)" }}>
                  Most Connected
                </span>
              )}
              <button
                onClick={() => setSidePanelOpen((v) => !v)}
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {sidePanelOpen ? "»" : "«"}
              </button>
            </div>

            {sidePanelOpen && (
              <div className="flex-1 overflow-y-auto px-2 py-1">
                {topConnected.map((node, i) => (
                  <button
                    key={node.id}
                    onClick={() => highlightNodeInGraph(node)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors"
                    style={{
                      background: selectedNode?.id === node.id ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    <span
                      className="font-medium"
                      style={{ color: "var(--text-muted)", minWidth: 16 }}
                    >
                      {i + 1}.
                    </span>
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: node.section ? getSectionColor(node.section) : "var(--accent)" }}
                    />
                    <span className="truncate flex-1" style={{ color: "var(--foreground)" }}>
                      {node.title}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                      style={{
                        fontSize: 10,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                      }}
                    >
                      {node.connections}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
