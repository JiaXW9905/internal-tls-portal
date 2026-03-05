/**
 * RTC topology canvas renderer
 * Supports dragging nodes / zones / client blocks and emits layout changes.
 */

const TOPO_COLORS = {
  zoneBg: ['#eef2ff', '#ecfdf5', '#fefce8', '#fdf2f8', '#f0f9ff'],
  zoneBorder: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9'],
  serverBg: '#ffffff',
  serverBorder: '#94a3b8',
  serverText: '#1e293b',
  serviceBg: '#f1f5f9',
  serviceText: '#334155',
  clientBg: '#dbeafe',
  clientBorder: '#3b82f6',
  fwBg: '#fef3c7',
  fwBorder: '#f59e0b',
  fwText: '#92400e',
  connMedia: '#ef4444',
  connBiz: '#3b82f6',
  connLabel: '#64748b',
  subtitle: '#64748b'
};

const FONT = {
  zone: 'bold 14px sans-serif',
  server: 'bold 11px sans-serif',
  service: '10px sans-serif',
  client: 'bold 11px sans-serif',
  fw: 'bold 10px sans-serif',
  conn: '10px sans-serif',
  ip: '9px monospace'
};

function renderTopologyCanvas(canvas, arch, options = {}) {
  if (!canvas || !arch) return;
  const enableDrag = !!options.enableDrag;
  const onLayoutChange = typeof options.onLayoutChange === 'function' ? options.onLayoutChange : null;
  const onLayoutToolsReady = typeof options.onLayoutToolsReady === 'function' ? options.onLayoutToolsReady : null;
  const onComponentSelect = typeof options.onComponentSelect === 'function' ? options.onComponentSelect : null;
  const selectedComponentId = options.selectedComponentId || null;
  const zoom = Number(options.zoom) > 0 ? Number(options.zoom) : 1;
  const fitToViewport = !!options.fitToViewport;
  const viewportWidth = Number(options.viewportWidth) > 0 ? Number(options.viewportWidth) : 0;
  const viewportHeight = Number(options.viewportHeight) > 0 ? Number(options.viewportHeight) : 0;

  const topology = arch.topology || {};
  const nodes = Array.isArray(arch.nodes) ? arch.nodes : [];
  const topologyNodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const zones = Array.isArray(topology.zones) ? [...topology.zones] : [];
  const connections = Array.isArray(topology.connections) ? topology.connections : [];
  const flatMode = topologyNodes.length > 0 || zones.length === 0;
  if (!nodes.length && !topologyNodes.length) return;

  const layout = arch.layout && typeof arch.layout === 'object' ? arch.layout : {};
  const nodePositions = { ...(layout.node_positions || {}) };
  const zonePositions = { ...(layout.zone_positions || {}) };
  const clientPositions = { ...(layout.client_positions || {}) };
  const componentPositions = { ...(layout.component_positions || {}) };
  const components = Array.isArray(arch.network_components) ? arch.network_components : [];

  const nodeMap = new Map();
  nodes.forEach((n, i) => {
    const id = n.node_id || n.hostname || `node-${i + 1}`;
    nodeMap.set(id, { ...n, node_id: id });
    if (n.hostname) nodeMap.set(n.hostname, { ...n, node_id: id });
  });

  const DPR = window.devicePixelRatio || 1;
  const PAD = 36;
  const ZONE_PAD = 18;
  const SERVER_W = 160;
  const SERVER_GAP = 16;
  const ZONE_GAP = 30;
  const CLIENT_W = 110;
  const CLIENT_H = 42;
  const CLIENT_X_OFFSET = 40;
  const EDGE_PAD = 8;

  const zoneLayouts = flatMode ? [] : zones.map((z) => {
    const zoneNodes = (z.nodes || []).map((nid) => nodeMap.get(nid)).filter(Boolean);
    const cols = Math.min(Math.max(zoneNodes.length, 1), 3);
    const rowHeights = [];
    zoneNodes.forEach((n, idx) => {
      const row = Math.floor(idx / cols);
      const h = getServerHeight(n);
      rowHeights[row] = Math.max(rowHeights[row] || 0, h);
    });
    if (!rowHeights.length) rowHeights.push(56);
    const rows = rowHeights.length;
    const hBody = rowHeights.reduce((a, b) => a + b, 0) + Math.max(0, rows - 1) * SERVER_GAP;
    const w = ZONE_PAD * 2 + cols * SERVER_W + (cols - 1) * SERVER_GAP;
    const h = ZONE_PAD * 2 + 26 + hBody;
    return { zone: z, zoneNodes, cols, rowHeights, w, h, x: 0, y: 0 };
  });

  const renderNodes = flatMode
    ? (topologyNodes.length ? topologyNodes.map((tn) => nodeMap.get(tn.node_id || tn.hostname)).filter(Boolean) : nodes)
    : [];
  const maxZoneW = flatMode ? Math.max(760, Math.min(1400, Math.ceil(Math.sqrt(Math.max(1, renderNodes.length))) * (SERVER_W + 40))) : Math.max(...zoneLayouts.map((z) => z.w), 460);
  const maxZoneH = flatMode ? 0 : Math.max(...zoneLayouts.map((z) => z.h), 240);
  const zoneCols = flatMode ? 1 : Math.min(2, Math.max(1, zoneLayouts.length));
  const zoneRows = flatMode ? 0 : Math.ceil(zoneLayouts.length / zoneCols);
  const zoneColGap = 40;
  const zoneRowGap = 44;

  const zonesAreaW = flatMode ? maxZoneW : zoneCols * maxZoneW + (zoneCols - 1) * zoneColGap;
  const canvasW = PAD * 2 + zonesAreaW + CLIENT_W + CLIENT_X_OFFSET + 30;
  const zonesStartY = PAD + CLIENT_H + 26;

  if (!flatMode) {
    zoneLayouts.forEach((zl, i) => {
      const col = i % zoneCols;
      const row = Math.floor(i / zoneCols);
      const defaultX = PAD + col * (maxZoneW + zoneColGap) + (maxZoneW - zl.w) / 2;
      const defaultY = zonesStartY + row * (maxZoneH + zoneRowGap);
      const saved = zonePositions[zl.zone.zone_id] || {};
      zl.x = Number.isFinite(saved.x) ? saved.x : defaultX;
      zl.y = Number.isFinite(saved.y) ? saved.y : defaultY;
    });
  }
  const canvasH = flatMode
    ? Math.max(560, zonesStartY + Math.ceil(renderNodes.length / Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, renderNodes.length)))))) * 150 + PAD)
    : Math.max(zonesStartY + zoneRows * (maxZoneH + zoneRowGap) + PAD, 560);

  let displayScale = zoom;
  if (fitToViewport && viewportWidth > 0 && viewportHeight > 0) {
    const fitScale = Math.min(viewportWidth / canvasW, viewportHeight / canvasH);
    displayScale = Math.max(0.2, fitScale * zoom);
  }

  canvas.width = canvasW * DPR * displayScale;
  canvas.height = canvasH * DPR * displayScale;
  canvas.style.width = `${canvasW * displayScale}px`;
  canvas.style.height = `${canvasH * displayScale}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(DPR * displayScale, DPR * displayScale);

  const hitboxes = [];
  const defaults = { nodes: {}, zones: {} };
  const emitLayout = () => {
    if (!onLayoutChange) return;
    onLayoutChange({
      ...(arch.layout || {}),
      node_positions: nodePositions,
      zone_positions: zonePositions,
      client_positions: clientPositions,
      component_positions: componentPositions
    });
  };
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const clampRectPositionWithBounds = (x, y, w, h, maxW, maxH) => ({
    x: clamp(x, EDGE_PAD, Math.max(EDGE_PAD, maxW - w - EDGE_PAD)),
    y: clamp(y, EDGE_PAD, Math.max(EDGE_PAD, maxH - h - EDGE_PAD))
  });
  const clampRectPosition = (x, y, w, h) => clampRectPositionWithBounds(x, y, w, h, canvasW, canvasH);
  const applyVisibleBounds = (bounds = { maxW: canvasW, maxH: canvasH }) => {
    const maxW = Number.isFinite(bounds.maxW) ? bounds.maxW : canvasW;
    const maxH = Number.isFinite(bounds.maxH) ? bounds.maxH : canvasH;
    zoneLayouts.forEach((zl) => {
      const next = clampRectPositionWithBounds(zl.x, zl.y, zl.w, zl.h, maxW, maxH);
      zl.x = next.x;
      zl.y = next.y;
      zonePositions[zl.zone.zone_id] = { x: zl.x, y: zl.y };
    });
    Object.entries(nodePositions).forEach(([nodeId, pos]) => {
      const nodeRef = nodeMap.get(nodeId) || { services: [] };
      const next = clampRectPositionWithBounds(
        Number(pos.x) || EDGE_PAD,
        Number(pos.y) || EDGE_PAD,
        SERVER_W,
        getServerHeight(nodeRef),
        maxW,
        maxH
      );
      nodePositions[nodeId] = next;
    });
    Object.entries(clientPositions).forEach(([clientId, pos]) => {
      const next = clampRectPositionWithBounds(Number(pos.x) || EDGE_PAD, Number(pos.y) || EDGE_PAD, CLIENT_W, CLIENT_H, maxW, maxH);
      clientPositions[clientId] = next;
    });
    components.forEach((c, i) => {
      const key = c.id || `component-${i + 1}`;
      const pos = componentPositions[key] || c.position || {};
      const next = clampRectPositionWithBounds(Number(pos.x) || EDGE_PAD, Number(pos.y) || EDGE_PAD, 90, 30, maxW, maxH);
      componentPositions[key] = next;
    });
  };

  const drawAll = (bounds = { maxW: canvasW, maxH: canvasH }) => {
    applyVisibleBounds(bounds);
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    hitboxes.length = 0;

    if (!flatMode) {
      zoneLayouts.forEach((zl, zi) => {
        drawZone(ctx, zl, zi);
        hitboxes.push({ type: 'zone', zoneId: zl.zone.zone_id, x: zl.x, y: zl.y, w: zl.w, h: zl.h });
        defaults.zones[zl.zone.zone_id] = { x: zl.x, y: zl.y };

        const startX = zl.x + 18;
        let rowStartY = zl.y + 32;
        zl.zoneNodes.forEach((node, ni) => {
          const col = ni % zl.cols;
          const row = Math.floor(ni / zl.cols);
          if (col === 0 && row > 0) rowStartY += zl.rowHeights[row - 1] + SERVER_GAP;
          const defaultX = startX + col * (SERVER_W + SERVER_GAP);
          const defaultY = rowStartY;
          defaults.nodes[node.node_id] = { x: defaultX, y: defaultY, zoneId: zl.zone.zone_id };
          const saved = nodePositions[node.node_id] || {};
          const rawX = Number.isFinite(saved.x) ? saved.x : defaultX;
          const rawY = Number.isFinite(saved.y) ? saved.y : defaultY;
          const h = getServerHeight(node);
          const clamped = clampRectPosition(rawX, rawY, SERVER_W, h);
          const nx = clamped.x;
          const ny = clamped.y;
          nodePositions[node.node_id] = { x: nx, y: ny };
          drawServer(ctx, nx, ny, SERVER_W, h, node);
          hitboxes.push({ type: 'node', nodeId: node.node_id, zoneId: zl.zone.zone_id, x: nx, y: ny, w: SERVER_W, h });
        });
      });
    } else {
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, renderNodes.length)))));
      renderNodes.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const defaultX = PAD + 24 + col * (SERVER_W + 36);
        const defaultY = zonesStartY + row * 150;
        defaults.nodes[node.node_id] = { x: defaultX, y: defaultY, zoneId: null };
        const saved = nodePositions[node.node_id] || {};
        const rawX = Number.isFinite(saved.x) ? saved.x : defaultX;
        const rawY = Number.isFinite(saved.y) ? saved.y : defaultY;
        const h = getServerHeight(node);
        const clamped = clampRectPosition(rawX, rawY, SERVER_W, h);
        const nx = clamped.x;
        const ny = clamped.y;
        nodePositions[node.node_id] = { x: nx, y: ny };
        drawServer(ctx, nx, ny, SERVER_W, h, node);
        hitboxes.push({ type: 'node', nodeId: node.node_id, zoneId: null, x: nx, y: ny, w: SERVER_W, h });
      });
    }

    const clientX = PAD + zonesAreaW + CLIENT_X_OFFSET;
    const clients = [
      { id: 'native_sdk', label: 'Native SDK', sub: 'Windows/Mac/iOS/Android', defaultY: PAD },
      { id: 'web_sdk', label: 'Web SDK', sub: 'Browser', defaultY: PAD + CLIENT_H + 12 }
    ];
    clients.forEach((c) => {
      const saved = clientPositions[c.id] || {};
      const rawX = Number.isFinite(saved.x) ? saved.x : clientX;
      const rawY = Number.isFinite(saved.y) ? saved.y : c.defaultY;
      const clamped = clampRectPosition(rawX, rawY, CLIENT_W, CLIENT_H);
      const cx = clamped.x;
      const cy = clamped.y;
      clientPositions[c.id] = { x: cx, y: cy };
      drawClient(ctx, cx, cy, CLIENT_W, CLIENT_H, c.label, c.sub);
      hitboxes.push({ type: 'client', clientId: c.id, x: cx, y: cy, w: CLIENT_W, h: CLIENT_H });
    });

    components.forEach((comp, idx) => {
      const cid = comp.id || `component-${idx + 1}`;
      const zone = zoneLayouts.find((z) => z.zone.zone_id === comp.zone_id) || zoneLayouts[0] || null;
      const defaultPos = {
        x: zone ? zone.x + Math.max(10, zone.w - 110) : PAD + zonesAreaW - 120,
        y: zone ? zone.y + 26 + idx * 34 : zonesStartY + idx * 34
      };
      const saved = componentPositions[cid] || comp.position || {};
      const rawX = Number.isFinite(saved.x) ? saved.x : defaultPos.x;
      const rawY = Number.isFinite(saved.y) ? saved.y : defaultPos.y;
      const clamped = clampRectPosition(rawX, rawY, 90, 30);
      componentPositions[cid] = clamped;
      drawNetworkComponent(ctx, clamped.x, clamped.y, 90, 30, comp, cid === selectedComponentId);
      hitboxes.push({ type: 'component', componentId: cid, x: clamped.x, y: clamped.y, w: 90, h: 30 });
    });

    const serviceAnchors = buildServiceAnchors(hitboxes, nodeMap);
    const serviceConnections = connections.filter((c) => c?.from_service && c?.to_service);
    if (serviceConnections.length) {
      serviceConnections.forEach((conn, idx) => {
        drawServiceConnection(ctx, conn, idx, serviceConnections.length, serviceAnchors, canvasW);
      });
    } else {
      const routeLaneX = PAD + zonesAreaW + 8;
      if (!flatMode) {
        connections.forEach((conn) => {
          const from = zoneLayouts.find((z) => z.zone.zone_id === conn.from_zone);
          const to = zoneLayouts.find((z) => z.zone.zone_id === conn.to_zone);
          if (from && to) drawConnection(ctx, from, to, conn, { laneX: routeLaneX });
        });
      } else {
        connections.forEach((conn, idx) => drawNodeConnection(ctx, conn, idx, hitboxes, canvasW));
      }
    }

    if (!flatMode && zoneLayouts.length) {
      const firstZone = zoneLayouts[0];
      const targetX = firstZone.x + firstZone.w;
      const nativePos = clientPositions.native_sdk || { x: clientX, y: PAD };
      const webPos = clientPositions.web_sdk || { x: clientX, y: PAD + CLIENT_H + 12 };
      const laneX = PAD + zonesAreaW + 8;
      drawPathArrow(ctx, [
        { x: nativePos.x, y: nativePos.y + CLIENT_H / 2 },
        { x: laneX, y: nativePos.y + CLIENT_H / 2 },
        { x: laneX, y: firstZone.y + firstZone.h / 2 },
        { x: targetX + 4, y: firstZone.y + firstZone.h / 2 }
      ], { color: TOPO_COLORS.connMedia, label: '媒体', lineDash: [] });
      drawPathArrow(ctx, [
        { x: webPos.x, y: webPos.y + CLIENT_H / 2 },
        { x: laneX + 12, y: webPos.y + CLIENT_H / 2 },
        { x: laneX + 12, y: firstZone.y + firstZone.h / 2 + 18 },
        { x: targetX + 4, y: firstZone.y + firstZone.h / 2 + 18 }
      ], { color: TOPO_COLORS.connBiz, label: '业务', lineDash: [6, 4] });
    }
  };

  drawAll();
  const resetToVisibleBounds = () => {
    const wrap = canvas.parentElement;
    const visibleW = wrap ? Math.max(120, Math.min(canvasW, (wrap.clientWidth || canvasW) / displayScale)) : canvasW;
    const visibleH = wrap ? Math.max(120, Math.min(canvasH, (wrap.clientHeight || canvasH) / displayScale)) : canvasH;
    drawAll({ maxW: visibleW, maxH: visibleH });
    emitLayout();
  };
  if (onLayoutToolsReady) {
    onLayoutToolsReady({ resetToVisibleBounds });
  }
  if (!enableDrag) return;

  let dragging = null;
  let offsetX = 0;
  let offsetY = 0;
  let lastX = 0;
  let lastY = 0;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / displayScale, y: (e.clientY - r.top) / displayScale };
  };
  const hit = (x, y) => {
    for (let i = hitboxes.length - 1; i >= 0; i--) {
      const hb = hitboxes[i];
      if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) return hb;
    }
    return null;
  };
  const onDown = (e) => {
    const p = getPos(e);
    const hb = hit(p.x, p.y);
    if (!hb) return;
    dragging = hb;
    if (hb.type === 'component' && onComponentSelect) {
      onComponentSelect(hb.componentId);
    }
    offsetX = p.x - hb.x;
    offsetY = p.y - hb.y;
    lastX = hb.x;
    lastY = hb.y;
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e) => {
    const p = getPos(e);
    if (!dragging) {
      canvas.style.cursor = hit(p.x, p.y) ? 'grab' : 'default';
      return;
    }
    const targetW = dragging.w || 40;
    const targetH = dragging.h || 30;
    const clamped = clampRectPosition(p.x - offsetX, p.y - offsetY, targetW, targetH);
    const nx = clamped.x;
    const ny = clamped.y;
    const prevX = lastX;
    const prevY = lastY;
    lastX = nx;
    lastY = ny;

    if (dragging.type === 'node') {
      nodePositions[dragging.nodeId] = { x: nx, y: ny };
    } else if (dragging.type === 'zone') {
      const zone = zoneLayouts.find((zl) => zl.zone.zone_id === dragging.zoneId);
      if (zone) {
        const zoneClamped = clampRectPosition(nx, ny, zone.w, zone.h);
        zonePositions[dragging.zoneId] = { x: zoneClamped.x, y: zoneClamped.y };
        const realDx = zoneClamped.x - prevX;
        const realDy = zoneClamped.y - prevY;
        lastX = zoneClamped.x;
        lastY = zoneClamped.y;
        zoneLayouts.forEach((zl) => {
          if (zl.zone.zone_id === dragging.zoneId) {
            zl.x = zoneClamped.x;
            zl.y = zoneClamped.y;
          }
        });
        Object.entries(defaults.nodes).forEach(([nodeId, def]) => {
          if (def.zoneId !== dragging.zoneId) return;
          const old = nodePositions[nodeId] || { x: def.x, y: def.y };
          const nodeRef = nodeMap.get(nodeId) || {};
          const moved = clampRectPosition(old.x + realDx, old.y + realDy, SERVER_W, getServerHeight(nodeRef));
          nodePositions[nodeId] = moved;
        });
      }
    } else if (dragging.type === 'client') {
      clientPositions[dragging.clientId] = { x: nx, y: ny };
    } else if (dragging.type === 'component') {
      componentPositions[dragging.componentId] = { x: nx, y: ny };
    }
    drawAll();
  };
  const onUp = () => {
    if (dragging) emitLayout();
    dragging = null;
    canvas.style.cursor = 'default';
  };

  if (canvas._topoHandlers) {
    const h = canvas._topoHandlers;
    canvas.removeEventListener('mousedown', h.onDown);
    canvas.removeEventListener('mousemove', h.onMove);
    window.removeEventListener('mouseup', h.onUp);
  }
  canvas._topoHandlers = { onDown, onMove, onUp };
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function getServerHeight(node) {
  const count = Array.isArray(node.services) ? node.services.length : 0;
  return 44 + Math.max(1, count) * 16;
}

function drawZone(ctx, zl, colorIdx) {
  const ci = colorIdx % TOPO_COLORS.zoneBg.length;
  ctx.fillStyle = TOPO_COLORS.zoneBg[ci];
  ctx.strokeStyle = TOPO_COLORS.zoneBorder[ci];
  ctx.lineWidth = 2;
  roundRect(ctx, zl.x, zl.y, zl.w, zl.h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TOPO_COLORS.zoneBorder[ci];
  ctx.font = FONT.zone;
  ctx.textAlign = 'center';
  ctx.fillText(zl.zone.name || zl.zone.zone_id, zl.x + zl.w / 2, zl.y + 18);
}

function drawServer(ctx, x, y, w, h, node) {
  ctx.fillStyle = TOPO_COLORS.serverBg;
  ctx.strokeStyle = TOPO_COLORS.serverBorder;
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TOPO_COLORS.serverText;
  ctx.font = FONT.server;
  ctx.textAlign = 'center';
  ctx.fillText(truncate(node.hostname || node.node_id || 'server', 24), x + w / 2, y + 14);
  if (node.ip_address) {
    ctx.font = FONT.ip;
    ctx.fillStyle = TOPO_COLORS.subtitle;
    ctx.fillText(node.ip_address, x + w / 2, y + 26);
  }

  const services = Array.isArray(node.services) ? node.services : [];
  ctx.textAlign = 'left';
  ctx.font = FONT.service;
  services.forEach((svc, i) => {
    const sy = y + 34 + i * 16;
    ctx.fillStyle = TOPO_COLORS.serviceBg;
    roundRect(ctx, x + 6, sy - 2, w - 12, 14, 3);
    ctx.fill();
    ctx.fillStyle = TOPO_COLORS.serviceText;
    ctx.fillText(String(svc || ''), x + 10, sy + 8);
  });
}

function drawClient(ctx, x, y, w, h, label, sub) {
  ctx.fillStyle = TOPO_COLORS.clientBg;
  ctx.strokeStyle = TOPO_COLORS.clientBorder;
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TOPO_COLORS.serverText;
  ctx.font = FONT.client;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 - 2);
  ctx.font = FONT.ip;
  ctx.fillStyle = TOPO_COLORS.subtitle;
  ctx.fillText(sub || '', x + w / 2, y + h / 2 + 11);
}

function drawNetworkComponent(ctx, x, y, w, h, component, selected) {
  const type = (component?.type || 'component').toLowerCase();
  const colorMap = {
    firewall: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
    alb: { bg: '#e0e7ff', border: '#6366f1', text: '#312e81' },
    proxy: { bg: '#dcfce7', border: '#10b981', text: '#065f46' },
    gateway: { bg: '#fee2e2', border: '#ef4444', text: '#7f1d1d' },
    component: { bg: '#f1f5f9', border: '#64748b', text: '#334155' }
  };
  const scheme = colorMap[type] || colorMap.component;
  ctx.fillStyle = scheme.bg;
  ctx.strokeStyle = selected ? '#111827' : scheme.border;
  ctx.lineWidth = selected ? 2.2 : 1.6;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = scheme.text;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  const label = component?.name || component?.type || 'component';
  ctx.fillText(truncate(label, 16), x + w / 2, y + h / 2 + 3);
}

function drawConnection(ctx, from, to, conn, routing = {}) {
  const startX = from.x + from.w;
  const startY = from.y + from.h / 2;
  const endX = to.x + to.w;
  const endY = to.y + to.h / 2;
  const laneX = Number.isFinite(routing.laneX) ? routing.laneX : Math.max(startX, endX) + 20;

  const flowText = String(conn.flow_type || conn.description || '').toLowerCase();
  const isMedia = flowText.includes('media') || flowText.includes('媒体');
  const isMgmt = flowText.includes('mgmt') || flowText.includes('管理') || flowText.includes('monitor');
  const color = isMedia ? TOPO_COLORS.connMedia : isMgmt ? '#16a34a' : TOPO_COLORS.connBiz;
  const lineDash = isMedia ? [] : isMgmt ? [2, 4] : [6, 4];

  if (conn.through) {
    const fwX = laneX - 40;
    const fwY = (startY + endY) / 2 - 15;
    ctx.fillStyle = TOPO_COLORS.fwBg;
    ctx.strokeStyle = TOPO_COLORS.fwBorder;
    ctx.lineWidth = 1.8;
    roundRect(ctx, fwX, fwY, 80, 30, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = TOPO_COLORS.fwText;
    ctx.font = FONT.fw;
    ctx.textAlign = 'center';
    ctx.fillText(truncate(conn.through, 12), fwX + 40, fwY + 19);
  }

  drawPathArrow(ctx, [
    { x: startX, y: startY },
    { x: laneX, y: startY },
    { x: laneX, y: endY },
    { x: endX, y: endY }
  ], { color, label: conn.description, lineDash });
}

function drawServiceConnection(ctx, conn, index, total, serviceAnchors, canvasW) {
  const fromKey = normalizeServiceKey(conn.from_service);
  const toKey = normalizeServiceKey(conn.to_service);
  const fromList = serviceAnchors.get(fromKey) || [];
  const toList = serviceAnchors.get(toKey) || [];
  if (!fromList.length || !toList.length) return;

  const from = fromList[0];
  const to = toList[0];
  const laneOffset = 28 + (index % Math.max(1, Math.min(total, 6))) * 14;
  const laneX = Math.min(canvasW - 12, Math.max(from.rightX, to.rightX) + laneOffset);

  const flowText = String(conn.flow_type || conn.protocol || conn.description || '').toLowerCase();
  const isMedia = flowText.includes('media') || flowText.includes('udp') || flowText.includes('媒体');
  const isMgmt = flowText.includes('mgmt') || flowText.includes('管理') || flowText.includes('monitor');
  const color = isMedia ? TOPO_COLORS.connMedia : isMgmt ? '#16a34a' : TOPO_COLORS.connBiz;
  const lineDash = isMedia ? [4, 3] : isMgmt ? [2, 4] : [];
  const label = conn.description || `${conn.protocol || ''}${conn.port ? `:${conn.port}` : ''}`;

  drawPathArrow(ctx, [
    { x: from.rightX, y: from.y },
    { x: laneX, y: from.y },
    { x: laneX, y: to.y },
    { x: to.leftX, y: to.y }
  ], { color, lineDash, label });
}

function drawNodeConnection(ctx, conn, index, hitboxes, canvasW) {
  const fromId = conn.from_node || conn.from || conn.source_node;
  const toId = conn.to_node || conn.to || conn.target_node;
  if (!fromId || !toId) return;
  const from = hitboxes.find((hb) => hb.type === 'node' && hb.nodeId === fromId);
  const to = hitboxes.find((hb) => hb.type === 'node' && hb.nodeId === toId);
  if (!from || !to) return;
  const laneX = Math.min(canvasW - 12, Math.max(from.x + from.w, to.x + to.w) + 22 + (index % 5) * 12);
  const flowText = String(conn.flow_type || conn.protocol || conn.description || '').toLowerCase();
  const isMedia = flowText.includes('media') || flowText.includes('udp') || flowText.includes('媒体');
  const isMgmt = flowText.includes('mgmt') || flowText.includes('管理') || flowText.includes('monitor');
  const color = isMedia ? TOPO_COLORS.connMedia : isMgmt ? '#16a34a' : TOPO_COLORS.connBiz;
  const lineDash = isMedia ? [4, 3] : isMgmt ? [2, 4] : [];
  const label = conn.description || `${conn.protocol || ''}${conn.port ? `:${conn.port}` : ''}`;
  drawPathArrow(ctx, [
    { x: from.x + from.w, y: from.y + from.h / 2 },
    { x: laneX, y: from.y + from.h / 2 },
    { x: laneX, y: to.y + to.h / 2 },
    { x: to.x, y: to.y + to.h / 2 }
  ], { color, lineDash, label });
}

function buildServiceAnchors(hitboxes, nodeMap) {
  const anchors = new Map();
  hitboxes
    .filter((hb) => hb.type === 'node')
    .forEach((hb) => {
      const node = nodeMap.get(hb.nodeId);
      const services = Array.isArray(node?.services) ? node.services : [];
      services.forEach((svc, idx) => {
        const key = normalizeServiceKey(svc);
        if (!key) return;
        const y = Math.min(hb.y + hb.h - 8, hb.y + 40 + idx * 16);
        if (!anchors.has(key)) anchors.set(key, []);
        anchors.get(key).push({
          leftX: hb.x,
          rightX: hb.x + hb.w,
          y
        });
      });
    });
  return anchors;
}

function normalizeServiceKey(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return '';
  const compact = key.replace(/[-\s]/g, '_');
  if (compact.includes('web_media_eage') || compact.includes('web_media_edge') || compact === 'web_edge' || compact === 'agora_web_media_edge') return 'web_edge';
  if (compact.includes('udp_media_edge') || compact === 'udp_edge' || compact === 'agora_udp_media_edge') return 'udp_edge';
  if (compact.includes('aut_media_edge') || compact === 'aut_edge' || compact === 'agora_aut_media_edge') return 'aut_edge';
  if (compact.includes('local_balancer') || compact === 'balancer') return 'local_balancer';
  if (compact.includes('local_ap') || compact === 'ap') return 'local_ap';
  if (compact.includes('event_collector')) return 'event_collector';
  if (compact.includes('cap_sync')) return 'cap_sync';
  if (compact.includes('vossync') || compact.includes('vosync')) return 'vosync';
  if (compact.includes('agora_arb') || compact === 'arb') return 'arb';
  return compact.replace(/^agora_/, '');
}

function drawPathArrow(ctx, points, style = {}) {
  if (!Array.isArray(points) || points.length < 2) return;
  const color = style.color || TOPO_COLORS.connBiz;
  const lineDash = Array.isArray(style.lineDash) ? style.lineDash : [];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(lineDash);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  const p1 = points[points.length - 2];
  const p2 = points[points.length - 1];
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const head = 8;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - head * Math.cos(angle - Math.PI / 6), p2.y - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(p2.x - head * Math.cos(angle + Math.PI / 6), p2.y - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();

  if (style.label) {
    const mid = points[Math.floor(points.length / 2)];
    ctx.fillStyle = TOPO_COLORS.connLabel;
    ctx.font = FONT.conn;
    ctx.textAlign = 'center';
    ctx.fillText(truncate(style.label, 22), mid.x, mid.y - 8);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 1)}...` : str;
}

window.renderTopologyCanvas = renderTopologyCanvas;
