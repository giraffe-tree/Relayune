// flutter_svg does not apply SVG stylesheets. Resolve Mermaid's theme and
// classDef styles in the isolated WebView before handing off a static picture.
function prepareMermaidSvg(source) {
  const host = document.createElement('div');
  host.innerHTML = source;
  document.body.append(host);
  const svg = host.querySelector('svg');
  const properties = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
    'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'font-family',
    'font-size', 'font-weight', 'font-style', 'text-anchor', 'visibility',
  ];
  // Snapshot first: modifying a parent must not change a child's computed style.
  const styles = [svg, ...svg.querySelectorAll('*')].map(element => {
    const computed = getComputedStyle(element);
    return [element, properties.map(name => [name, computed.getPropertyValue(name)])];
  });
  for (const [element, attributes] of styles) {
    element.removeAttribute('style');
    for (const [name, value] of attributes) {
      // Browsers expand local paint references to absolute about:blank URLs.
      const local = value.replace(/url\(["']?[^)"']*#([^"')]+)["']?\)/g, 'url(#$1)');
      if (local) element.setAttribute(name, local);
    }
  }
  // Nested tspan positioning accumulates group transforms in flutter_svg.
  // Export each styled text run with its measured baseline in root coordinates.
  const textRuns = [];
  const rootInverse = svg.getScreenCTM().inverse();
  for (const run of svg.querySelectorAll('text, tspan')) {
    if (run.querySelector('tspan') || !run.getNumberOfChars()) continue;
    const point = run.getStartPositionOfChar(0);
    const matrix = rootInverse.multiply(run.getScreenCTM());
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    for (const name of properties) {
      const value = run.getAttribute(name);
      if (value) label.setAttribute(name, value);
    }
    label.setAttribute('x', point.x);
    label.setAttribute('y', point.y);
    label.setAttribute('text-anchor', 'start');
    label.setAttribute('transform', `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    label.textContent = run.textContent;
    textRuns.push(label);
  }
  svg.querySelectorAll('text').forEach(element => element.remove());
  svg.append(...textRuns);
  // The native renderer also ignores SVG markers. Preserve arrowheads as
  // ordinary geometry in the edge's coordinate system, including start arrows.
  for (const path of svg.querySelectorAll('[marker-start], [marker-end]')) {
    if (typeof path.getTotalLength !== 'function') continue;
    const length = path.getTotalLength();
    if (!length) continue;
    for (const end of ['start', 'end']) {
      const reference = path.getAttribute('marker-' + end);
      const id = reference?.match(/#([^"')]+)["']?\)/)?.[1];
      const marker = id && svg.querySelector('[id="' + CSS.escape(id) + '"]');
      if (!marker) continue;
      const point = path.getPointAtLength(end === 'end' ? length : 0);
      const near = path.getPointAtLength(end === 'end' ? Math.max(0, length - 0.1) : Math.min(length, 0.1));
      let angle = Math.atan2(end === 'end' ? point.y - near.y : near.y - point.y,
        end === 'end' ? point.x - near.x : near.x - point.x) * 180 / Math.PI;
      if (marker.getAttribute('orient') === 'auto-start-reverse' && end === 'start') angle += 180;
      const box = marker.viewBox.baseVal;
      const unit = marker.getAttribute('markerUnits') === 'userSpaceOnUse' ? 1 : parseFloat(path.getAttribute('stroke-width')) || 1;
      const scale = Math.min(marker.markerWidth.baseVal.value / box.width, marker.markerHeight.baseVal.value / box.height) * unit;
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      arrow.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle}) scale(${scale}) translate(${-marker.refX.baseVal.value} ${-marker.refY.baseVal.value})`);
      for (const child of marker.children) arrow.append(child.cloneNode(true));
      path.parentNode.append(arrow);
      path.removeAttribute('marker-' + end);
    }
  }
  svg.querySelectorAll('marker').forEach(element => element.remove());
  svg.querySelectorAll('style').forEach(element => element.remove());
  // Mermaid also emits decorative drop-shadow definitions. flutter_svg has no
  // filter implementation; omit those effects along with their references.
  svg.querySelectorAll('filter').forEach(element => element.remove());
  svg.querySelectorAll('[filter]').forEach(element => element.removeAttribute('filter'));
  svg.querySelectorAll('defs').forEach(element => {
    if (!element.childElementCount) element.remove();
  });
  svg.setAttribute('width', svg.viewBox.baseVal.width);
  svg.setAttribute('height', svg.viewBox.baseVal.height);
  const result = new XMLSerializer().serializeToString(svg);
  host.remove();
  return result;
}
