const FILES = {
  properties: "data/annual-energy-consumption-data-Properties.csv",
  meters: "data/annual-energy-consumption-data-2024-Meter Entries.csv"
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SELECTED_TYPES = [
  "Library",
  "Fire Station",
  "Community Center and Social Meeting Hall",
  "Office",
  "Indoor Arena",
  "Police Station",
  "Transportation Terminal/Station"
];

const MEASURES = {
  electricity: {
    label: "Electricity",
    shortUnit: "kWh / sq ft",
    match: value => /electric/i.test(value || "")
  },
  gas: {
    label: "Natural Gas",
    shortUnit: "m³ / sq ft",
    match: value => /natural gas/i.test(value || "")
  }
};

const state = {
  measure: "electricity",
  monthIndex: null,
  visibleTypes: new Set(SELECTED_TYPES),
  highlightedType: null,
  data: [],
  maxByMeasure: {},
  timer: null,
  duration: 900
};

const svg = d3.select("#wheel");
const width = 980;
const height = 900;
const cx = width / 2;
const cy = height / 2 + 10;
const outerRadius = 315;
const innerRadius = 90;
const monthLabelRadius = outerRadius + 34;
const focusRadius = 12;
const color = d3.scaleOrdinal()
  .domain(SELECTED_TYPES)
  .range(["#4f46e5", "#ef4444", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ec4899"]);

const root = svg.append("g").attr("transform", `translate(${cx},${cy})`);
const ringsLayer = root.append("g");
const spokesLayer = root.append("g");
const annotationLayer = root.append("g");
const seriesLayer = root.append("g");
const pointsLayer = root.append("g");
const focusLayer = root.append("g");

const tooltip = d3.select("#tooltip");
const legend = d3.select("#legend");
const measureToggle = d3.select("#measure-toggle");

const radiusScale = d3.scaleLinear().range([innerRadius, outerRadius]);
const angleForMonth = monthIndex => (monthIndex / 12) * Math.PI * 2 - Math.PI / 2;
const xForPoint = d => Math.cos(angleForMonth(d.monthIndex)) * d.radius;
const yForPoint = d => Math.sin(angleForMonth(d.monthIndex)) * d.radius;
const radialLine = d3.line()
  .x(xForPoint)
  .y(yForPoint)
  .curve(d3.curveLinearClosed);

Promise.all([
  d3.csv(FILES.properties, d => ({
    id: String(d["Portfolio Manager ID"] || "").trim(),
    type: String(d["Property Type - Self-Selected"] || "").trim(),
    gfa: +String(d["Gross Floor Area"] || "").replace(/,/g, "")
  })),
  d3.csv(FILES.meters, d => ({
    id: String(d["Portfolio Manager ID"] || "").trim(),
    meterType: String(d["Meter Type"] || "").trim(),
    monthIndex: parseMonthIndex(d["Start Date"]),
    usage: +String(d["Usage/Quantity"] || "").replace(/,/g, "")
  }))
]).then(([properties, meters]) => {
  buildData(properties, meters);
  drawStaticFrame();
  buildLegend();
  bindControls();
  render(true);
}).catch(err => {
  console.error(err);
});

function parseMonthIndex(value) {
  const text = String(value || "").trim();
  const month = text.slice(5, 7);
  const parsed = +month;
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 12 ? parsed - 1 : null;
}

function buildData(properties, meters) {
  const propertyMap = new Map();

  properties.forEach(d => {
    if (!d.id || !d.type || !Number.isFinite(d.gfa) || d.gfa <= 0) return;
    propertyMap.set(d.id, { type: d.type, gfa: d.gfa });
  });

  const measurePropertySets = {
    electricity: new Map(),
    gas: new Map()
  };
  const usageSums = new Map();

  meters.forEach(row => {
    if (!Number.isFinite(row.monthIndex) || !Number.isFinite(row.usage) || row.usage < 0) return;
    const property = propertyMap.get(row.id);
    if (!property || !SELECTED_TYPES.includes(property.type)) return;

    let measure = null;
    if (MEASURES.electricity.match(row.meterType)) measure = "electricity";
    if (MEASURES.gas.match(row.meterType)) measure = "gas";
    if (!measure) return;

    if (!measurePropertySets[measure].has(property.type)) {
      measurePropertySets[measure].set(property.type, new Map());
    }
    measurePropertySets[measure].get(property.type).set(row.id, property.gfa);

    const key = `${measure}||${property.type}||${row.monthIndex}`;
    usageSums.set(key, (usageSums.get(key) || 0) + row.usage);
  });

  const denominator = {
    electricity: new Map(),
    gas: new Map()
  };

  Object.keys(measurePropertySets).forEach(measure => {
    measurePropertySets[measure].forEach((propMap, type) => {
      denominator[measure].set(type, d3.sum([...propMap.values()]));
    });
  });

  const data = [];
  const maxByMeasure = { electricity: 0, gas: 0 };

  SELECTED_TYPES.forEach(type => {
    Object.keys(MEASURES).forEach(measure => {
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const denom = denominator[measure].get(type) || 1;
        const value = (usageSums.get(`${measure}||${type}||${monthIndex}`) || 0) / denom;
        data.push({ type, measure, monthIndex, value });
        if (value > maxByMeasure[measure]) maxByMeasure[measure] = value;
      }
    });
  });

  state.data = data;
  state.maxByMeasure = maxByMeasure;
}

function drawStaticFrame() {
  const ringRadii = d3.range(5).map(i => innerRadius + ((outerRadius - innerRadius) * i) / 4);

  ringsLayer.selectAll("circle")
    .data(ringRadii)
    .join("circle")
    .attr("class", "ring")
    .attr("r", d => d);

  spokesLayer.selectAll("line")
    .data(d3.range(12))
    .join("line")
    .attr("class", "spoke")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", d => Math.cos(angleForMonth(d)) * outerRadius)
    .attr("y2", d => Math.sin(angleForMonth(d)) * outerRadius);

  annotationLayer.append("text")
    .attr("class", "axis-label")
    .attr("x", 0)
    .attr("y", -outerRadius - 66)
    .attr("text-anchor", "middle")
    .text("Month →");

  annotationLayer.append("text")
    .attr("class", "axis-label")
    .attr("x", 0)
    .attr("y", outerRadius + 78)
    .attr("text-anchor", "middle")
    .text("Energy intensity");

  annotationLayer.selectAll(".month-text")
    .data(MONTHS.map((label, monthIndex) => ({ label, monthIndex })))
    .join("text")
    .attr("class", "month-text")
    .attr("x", d => Math.cos(angleForMonth(d.monthIndex)) * monthLabelRadius)
    .attr("y", d => Math.sin(angleForMonth(d.monthIndex)) * monthLabelRadius)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .text(d => d.label);

  annotationLayer.append("text")
    .attr("class", "center-measure")
    .attr("y", -6)
    .attr("id", "center-measure")

  focusLayer.append("circle")
    .attr("class", "focus-dot")
    .attr("r", focusRadius)
    .attr("opacity", 0);
}

function buildLegend() {
  legend.selectAll("button")
    .data(SELECTED_TYPES)
    .join("button")
    .attr("class", "legend-item")
    .classed("is-hidden", d => !state.visibleTypes.has(d))
    .html(d => `<span class="legend-swatch" style="background:${color(d)}"></span><span>${d}</span>`)
    .on("click", (event, type) => {
      if (state.visibleTypes.has(type)) {
        if (state.visibleTypes.size === 1) return;
        state.visibleTypes.delete(type);
      } else {
        state.visibleTypes.add(type);
      }
      updateLegend();
      render();
    })
    .on("mouseenter", (event, type) => {
      state.highlightedType = type;
      render();
    })
    .on("mouseleave", () => {
      state.highlightedType = null;
      render();
    });
}

function bindControls() {
  measureToggle.selectAll("button").on("click", function () {
    const nextMeasure = this.dataset.measure;
    if (nextMeasure === state.measure) return;
    state.measure = nextMeasure;
    measureToggle.selectAll("button").classed("is-active", false);
    d3.select(this).classed("is-active", true);
    render();
  });
}


function render(initial = false) {
  radiusScale.domain([0, state.maxByMeasure[state.measure] * 1.05 || 1]);
  d3.select("#center-measure").text(`${MEASURES[state.measure].label} · ${MEASURES[state.measure].shortUnit}`);

  const ticks = radiusScale.ticks(4).filter(d => d > 0);
  const tickJoin = ringsLayer.selectAll(".tick-text").data(ticks, d => d);
  tickJoin.join(
    enter => enter.append("text")
      .attr("class", "tick-text")
      .attr("x", 8)
      .attr("y", d => -radiusScale(d))
      .attr("dy", -4)
      .text(d => formatTick(d)),
    update => update,
    exit => exit.remove()
  ).transition().duration(initial ? 0 : 650)
    .attr("y", d => -radiusScale(d))
    .text(d => formatTick(d));

  spokesLayer.selectAll("line")
    .classed("active", (d, i) => i === state.monthIndex);

  annotationLayer.selectAll(".month-text")
    .classed("active", d => d.monthIndex === state.monthIndex);

  const seriesData = SELECTED_TYPES.map(type => ({
    type,
    values: state.data
      .filter(d => d.measure === state.measure && d.type === type)
      .map(d => ({ ...d, radius: radiusScale(d.value) }))
  }));

  seriesLayer.selectAll("path")
    .data(seriesData, d => d.type)
    .join(
      enter => enter.append("path")
        .attr("class", "path-series")
        .attr("stroke", d => color(d.type))
        .attr("d", d => radialLine(d.values)),
      update => update,
      exit => exit.remove()
    )
    .classed("hidden", d => !state.visibleTypes.has(d.type))
    .classed("faded", d => state.highlightedType && d.type !== state.highlightedType)
    .transition().duration(initial ? 0 : 700)
    .attr("stroke", d => color(d.type))
    .attr("d", d => radialLine(d.values));

  const flatPoints = seriesData.flatMap(series =>
    series.values.map(point => ({ ...point, color: color(series.type) }))
  );

  pointsLayer.selectAll("circle")
    .data(flatPoints, d => `${d.type}-${d.measure}-${d.monthIndex}`)
    .join(
      enter => enter.append("circle")
        .attr("class", "point")
        .attr("r", 3.8)
        .attr("cx", xForPoint)
        .attr("cy", yForPoint)
        .attr("fill", d => d.color)
        .on("mouseenter", handlePointEnter)
        .on("mousemove", handlePointMove)
        .on("mouseleave", handlePointLeave),
      update => update,
      exit => exit.remove()
    )
    .classed("hidden", d => !state.visibleTypes.has(d.type))
    .transition().duration(initial ? 0 : 700)
    .attr("cx", xForPoint)
    .attr("cy", yForPoint)
    .attr("fill", d => d.color)
    .attr("opacity", d => state.highlightedType && d.type !== state.highlightedType ? 0.18 : 0.85)
    .attr("r", 3.8);

  focusLayer.select("circle")
    .transition().duration(initial ? 0 : 700)
    .attr("opacity", 0)
    .attr("r", 0);

  updateLegend();
}

function handlePointEnter(event, d) {
  state.highlightedType = d.type;
  render();
  tooltip.attr("hidden", null).style("opacity", 1)
    .html(`<strong>${d.type}</strong><br>${MONTHS[d.monthIndex]}<br>${MEASURES[d.measure].label}: ${formatTooltip(d.value)} ${MEASURES[d.measure].shortUnit}`);
  handlePointMove(event);
}

function handlePointMove(event) {
  const [x, y] = d3.pointer(event, document.querySelector('.chart-card'));
  tooltip.style("left", `${x + 10}px`).style("top", `${y + 10}px`);
}

function handlePointLeave() {
  state.highlightedType = null;
  render();
  tooltip.attr("hidden", true).style("opacity", 0);
}

function updateLegend() {
  legend.selectAll(".legend-item")
    .classed("is-hidden", d => !state.visibleTypes.has(d));
}

function formatTick(value) {
  if (state.measure === "electricity") {
    return value >= 10 ? value.toFixed(0) : value.toFixed(1);
  }
  return value >= 1 ? value.toFixed(1) : value.toFixed(2);
}

function formatTooltip(value) {
  if (state.measure === "electricity") {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}
