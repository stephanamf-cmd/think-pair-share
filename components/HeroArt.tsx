/** Decorative, static preview of the idea graph (server-rendered SVG). */
export default function HeroArt() {
  // deterministic pseudo-random layout
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const colors = ["#A8CC30", "#30B4B4", "#FCD80C", "#FCA83C", "#8EC5FF", "#F28CB1"];
  const nodes = Array.from({ length: 26 }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    const r = 40 + rnd() * 165;
    return { x: 300 + Math.cos(a) * r * 1.1, y: 225 + Math.sin(a) * r * 0.78, c: colors[i % colors.length], s: 4 + rnd() * 7 };
  });
  const edges: [number, number, string, boolean][] = [];
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes
      .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of near) if (j > i) edges.push([i, j, rnd() > 0.5 ? "#A8CC30" : "#30B4B4", rnd() > 0.55]);
  }
  const labels = ["heat moves particles", "energy is conserved", "friction → heat", "particles vibrate"];
  return (
    <svg viewBox="0 0 600 450" role="img">
      {edges.map(([a, b, c, dashed], i) => (
        <line
          key={i}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          stroke={dashed ? "#8fa6cf" : c}
          strokeOpacity={dashed ? 0.45 : 0.75}
          strokeWidth={dashed ? 1 : 1.8}
          strokeDasharray={dashed ? "4 4" : undefined}
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.s * 2.2} fill={n.c} opacity={0.12} />
          <circle cx={n.x} cy={n.y} r={n.s} fill={n.c} />
        </g>
      ))}
      {labels.map((l, i) => (
        <text
          key={l}
          x={nodes[i * 5].x}
          y={nodes[i * 5].y + nodes[i * 5].s + 14}
          fill="#eef2fa"
          fontSize="12"
          textAnchor="middle"
          fontFamily="Inter Variable, system-ui, sans-serif"
          stroke="#0f1b33"
          strokeWidth="3"
          paintOrder="stroke"
        >
          {l}
        </text>
      ))}
    </svg>
  );
}
