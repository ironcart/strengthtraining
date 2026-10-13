// Minimal SVG charts with hover tooltips. Colors come from CSS custom
// properties so light/dark themes swap in one place.

const NS = 'http://www.w3.org/2000/svg';
const M = { top: 16, right: 16, bottom: 28, left: 44 };

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Rounded "nice" tick values covering [min, max]. */
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function frame(container, height) {
  container.innerHTML = '';
  container.classList.add('chart');
  const width = Math.max(260, container.clientWidth || 320);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' }, container);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);
  return { svg, tip, width, height, iw: width - M.left - M.right, ih: height - M.top - M.bottom };
}

function yAxis(svg, ticks, y, width, fmt) {
  const g = el('g', { class: 'axis' }, svg);
  for (const t of ticks) {
    el('line', { x1: M.left, x2: width - M.right, y1: y(t), y2: y(t), class: 'grid' }, g);
    const label = el('text', { x: M.left - 8, y: y(t) + 4, 'text-anchor': 'end' }, g);
    label.textContent = fmt(t);
  }
}

function showTip(tip, container, x, y, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(0, x - tw / 2), cw - tw)}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
}

/** Re-renders a chart whenever its container changes width. */
export function responsive(container, draw) {
  draw();
  if (container._ro) container._ro.disconnect();
  let w = container.clientWidth;
  container._ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - w) > 4) { w = container.clientWidth; draw(); }
  });
  container._ro.observe(container);
}

/**
 * Time-scaled line chart.
 * series: [{ name, color, dashed?, points: [{ date: 'YYYY-MM-DD', y, meta? }] }]
 */
export function lineChart(container, { series, height = 220, fmt = (v) => v, tooltip }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) { container.innerHTML = '<p class="empty">No data yet</p>'; return; }
  const { svg, tip, width, iw, ih } = frame(container, height);
  const times = all.map((p) => Date.parse(p.date));
  let t0 = Math.min(...times), t1 = Math.max(...times);
  if (t0 === t1) { t0 -= 3 * 864e5; t1 += 3 * 864e5; }
  const vals = all.map((p) => p.y);
  const pad = (Math.max(...vals) - Math.min(...vals)) * 0.12 || 5;
  const ticks = niceTicks(Math.min(...vals) - pad, Math.max(...vals) + pad);
  const x = (d) => M.left + ((Date.parse(d) - t0) / (t1 - t0)) * iw;
  const y = (v) => M.top + ih - ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * ih;

  yAxis(svg, ticks, y, width, fmt);
  // x labels: first, last and up to 3 in between
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const step = Math.max(1, Math.ceil(dates.length / 5));
  const xg = el('g', { class: 'axis' }, svg);
  dates.forEach((d, i) => {
    if (i % step && i !== dates.length - 1) return;
    const t = el('text', { x: x(d), y: height - 8, 'text-anchor': 'middle' }, xg);
    t.textContent = shortDate(d);
  });

  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    el('path', { d, class: 'line', stroke: s.color, 'stroke-dasharray': s.dashed ? '5 4' : null }, svg);
    for (const p of s.points) {
      el('circle', { cx: x(p.date), cy: y(p.y), r: s.dashed ? 3 : 4.5, class: 'dot', fill: s.dashed ? 'var(--surface)' : s.color, stroke: s.dashed ? s.color : 'var(--surface)' }, svg);
    }
  }

  // crosshair + nearest-date tooltip
  const cross = el('line', { y1: M.top, y2: M.top + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: M.left, y: M.top, width: iw, height: ih, fill: 'transparent' }, svg);
  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left) * (width / r.width);
    const date = dates.reduce((best, d) => (Math.abs(x(d) - px) < Math.abs(x(best) - px) ? d : best), dates[0]);
    cross.setAttribute('x1', x(date)); cross.setAttribute('x2', x(date)); cross.setAttribute('visibility', 'visible');
    const rows = series.map((s) => ({ s, p: s.points.find((p) => p.date === date) })).filter((r) => r.p);
    const top = Math.min(...rows.map((r) => y(r.p.y)));
    showTip(tip, container, x(date) * (r.width / width), top * (r.height / height), tooltip ? tooltip(date, rows) :
      `<b>${shortDate(date)}</b>${rows.map(({ s, p }) => `<div><i style="background:${s.color}"></i>${s.name} <b>${fmt(p.y)}</b></div>`).join('')}`);
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

/**
 * Bar chart (optionally stacked).
 * bars: [{ label, segments: [{ name, value, color }], meta? }]
 * threshold: { value, label } draws a dashed reference line.
 */
export function barChart(container, { bars, height = 200, fmt = (v) => v, threshold, tooltip }) {
  if (!bars.length) { container.innerHTML = '<p class="empty">No data yet</p>'; return; }
  const { svg, tip, width, iw, ih } = frame(container, height);
  const totals = bars.map((b) => b.segments.reduce((a, s) => a + s.value, 0));
  const maxV = Math.max(...totals, threshold ? threshold.value : 0) * 1.08 || 1;
  const ticks = niceTicks(0, maxV);
  const y = (v) => M.top + ih - (v / ticks.at(-1)) * ih;
  yAxis(svg, ticks, y, width, fmt);
  el('line', { x1: M.left, x2: width - M.right, y1: y(0), y2: y(0), class: 'baseline' }, svg);

  const band = iw / bars.length;
  const bw = Math.min(36, band * 0.62);
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8));
  bars.forEach((b, i) => {
    const cx = M.left + band * i + band / 2;
    let acc = 0;
    const g = el('g', { class: 'bar' }, svg);
    b.segments.forEach((s, j) => {
      if (!s.value) return;
      const y0 = y(acc), y1 = y(acc + s.value);
      acc += s.value;
      const isTop = j === b.segments.length - 1 || b.segments.slice(j + 1).every((q) => !q.value);
      const h = Math.max(1, y0 - y1 - (isTop ? 0 : 2)); // 2px surface gap between stacked segments
      const r = isTop ? Math.min(4, h / 2, bw / 2) : 0;
      const x0 = cx - bw / 2;
      const top = y1;
      const d = r
        ? `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${top + h}Z`
        : `M${x0},${top + h}V${top}H${x0 + bw}V${top + h}Z`;
      el('path', { d, fill: s.color }, g);
    });
    if (i % labelEvery === 0 || i === bars.length - 1) {
      const t = el('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'axis-label' }, svg);
      t.textContent = b.label;
    }
    const hit = el('rect', { x: cx - band / 2, y: M.top, width: band, height: ih, fill: 'transparent' }, svg);
    const show = () => {
      g.classList.add('hover');
      const r = svg.getBoundingClientRect();
      showTip(tip, container, cx * (r.width / width), y(totals[i]) * (r.height / height), tooltip ? tooltip(b, totals[i]) :
        `<b>${b.label}</b>${b.segments.filter((s) => s.value).map((s) => `<div><i style="background:${s.color}"></i>${s.name} <b>${fmt(s.value)}</b></div>`).join('')}`);
    };
    const hide = () => { g.classList.remove('hover'); tip.hidden = true; };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  });

  if (threshold) {
    const ty = y(threshold.value);
    el('line', { x1: M.left, x2: width - M.right, y1: ty, y2: ty, class: 'threshold' }, svg);
    const t = el('text', { x: width - M.right, y: ty - 6, 'text-anchor': 'end', class: 'threshold-label' }, svg);
    t.textContent = threshold.label;
  }
}

/** Tiny inline trend line for exercise cards. */
export function sparkline(values, { width = 96, height = 28 } = {}) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (width - 4), height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const [lx, ly] = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path d="${d}"/><circle cx="${lx}" cy="${ly}" r="3"/></svg>`;
}
