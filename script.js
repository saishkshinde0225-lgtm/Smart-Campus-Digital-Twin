"use strict";

const elements = {
  serverStatus: document.getElementById("serverStatus"),
  campusTitle: document.getElementById("campusTitle"),
  connectedCount: document.getElementById("connectedCount"),
  studentCountNote: document.getElementById("studentCountNote"),
  apCount: document.getElementById("apCount"),
  networkUtilization: document.getElementById("networkUtilization"),
  networkDemand: document.getElementById("networkDemand"),
  networkCondition: document.getElementById("networkCondition"),
  conditionNote: document.getElementById("conditionNote"),
  notice: document.getElementById("notice"),
  campusMap: document.getElementById("campusMap"),
  mapNodes: document.getElementById("mapNodes"),
  mapHint: document.getElementById("mapHint"),
  emptySelection: document.getElementById("emptySelection"),
  studentDetails: document.getElementById("studentDetails"),
  apDetails: document.getElementById("apDetails"),
  detailStudentName: document.getElementById("detailStudentName"),
  detailConnection: document.getElementById("detailConnection"),
  detailNearestAp: document.getElementById("detailNearestAp"),
  detailSignal: document.getElementById("detailSignal"),
  detailDistance: document.getElementById("detailDistance"),
  detailPosition: document.getElementById("detailPosition"),
  detailDemand: document.getElementById("detailDemand"),
  detailApName: document.getElementById("detailApName"),
  detailApClients: document.getElementById("detailApClients"),
  detailApUtilization: document.getElementById("detailApUtilization"),
  detailApCapacity: document.getElementById("detailApCapacity"),
  detailApSignal: document.getElementById("detailApSignal"),
  detailApPosition: document.getElementById("detailApPosition"),
  addStudentButton: document.getElementById("addStudentButton"),
  removeStudentButton: document.getElementById("removeStudentButton"),
  resetButton: document.getElementById("resetButton"),
  apList: document.getElementById("apList"),
  apListCount: document.getElementById("apListCount"),
  historyCurrent: document.getElementById("historyCurrent"),
  historyEmpty: document.getElementById("historyEmpty"),
  historyChart: document.getElementById("historyChart"),
  historyLabels: document.getElementById("historyLabels")
};

const state = {
  campus: null,
  metrics: null,
  history: [],
  selectedUserId: null,
  selectedApId: null,
  drag: null,
  noticeTimer: null
};

const SVG_NS = "http://www.w3.org/2000/svg";

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

async function loadDashboard() {
  try {
    const [status, campus, metrics, history] = await Promise.all([
      requestJson("/api/status"),
      requestJson("/api/campus"),
      requestJson("/api/metrics"),
      requestJson("/api/simulation/history?limit=30")
    ]);
    state.campus = campus;
    state.metrics = metrics;
    state.history = history;
    elements.serverStatus.textContent = status.status;
    elements.serverStatus.dataset.state = "connected";
    renderDashboard();
    hideNotice();
  } catch (error) {
    elements.serverStatus.textContent = "Backend unavailable";
    elements.serverStatus.dataset.state = "error";
    showNotice(`${error.message} Check that the server and MySQL are running.`);
  }
}

function renderDashboard() {
  const { campus, metrics } = state;
  elements.campusTitle.textContent = campus.name;
  elements.connectedCount.textContent = String(metrics.connectedUserCount);
  elements.studentCountNote.textContent = `${metrics.userCount} simulated client${metrics.userCount === 1 ? "" : "s"} in total`;
  elements.apCount.textContent = String(metrics.accessPointCount);
  elements.networkUtilization.textContent = `${formatNumber(metrics.utilizationPercent)}%`;
  elements.networkDemand.textContent = `${formatNumber(metrics.totalDemandMbps)} / ${formatNumber(metrics.totalCapacityMbps)} Mbps`;

  const condition = metrics.userCount === 0
    ? "IDLE"
    : metrics.connectedUserCount === 0
      ? "NO CLIENTS CONNECTED"
      : metrics.condition === "congested"
        ? "CONGESTED"
        : metrics.condition === "busy"
          ? "BUSY"
          : "NORMAL";
  elements.networkCondition.textContent = condition;
  elements.networkCondition.dataset.level = metrics.condition === "congested"
    ? "critical"
    : metrics.condition === "busy"
      ? "warning"
      : "good";
  elements.conditionNote.textContent = metrics.userCount === 0
    ? "No simulated client traffic"
    : metrics.connectedUserCount === 0
      ? "All clients outside modeled coverage"
      : `Busiest AP: ${formatNumber(metrics.busiestAccessPointUtilizationPercent)}%`;
  elements.addStudentButton.disabled = metrics.userCount >= campus.maxUsers;
  elements.removeStudentButton.disabled = state.selectedUserId === null;

  renderMap(metrics);
  renderApList(metrics);
  renderSelection(metrics);
  renderHistory(state.history);
}

function renderMap(metrics) {
  elements.mapNodes.replaceChildren();
  for (const ap of metrics.accessPoints) {
    const coverage = document.createElement("span");
    coverage.className = "coverage";
    coverage.style.left = `${ap.x}%`;
    coverage.style.top = `${ap.y}%`;
    coverage.dataset.load = ap.condition === "busy" ? "busy" : ap.condition === "congested" ? "congested" : "";
    coverage.setAttribute("aria-hidden", "true");
    elements.mapNodes.append(coverage);

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "ap-marker";
    marker.style.left = `${ap.x}%`;
    marker.style.top = `${ap.y}%`;
    marker.dataset.load = ap.condition === "busy" ? "busy" : ap.condition === "congested" ? "congested" : "";
    marker.setAttribute("aria-label", `${ap.id}, ${ap.name}, ${ap.clientCount} clients, ${formatNumber(ap.utilizationPercent)} percent utilized`);
    marker.setAttribute("aria-pressed", String(state.selectedApId === ap.id));
    marker.textContent = ap.id;
    marker.title = `${ap.name} · ${ap.clientCount} clients · ${formatNumber(ap.utilizationPercent)}% utilized`;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedApId = ap.id;
      state.selectedUserId = null;
      renderDashboard();
    });
    elements.mapNodes.append(marker);
  }

  for (const user of metrics.users) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "student-marker";
    marker.style.left = `${user.x}%`;
    marker.style.top = `${user.y}%`;
    marker.dataset.quality = user.signalQuality;
    marker.setAttribute("aria-label", `${user.name}, ${user.connected ? "connected to " + user.apId : "disconnected"}, estimated ${user.rssiDbm === null ? "unavailable" : user.rssiDbm + " dBm"}`);
    marker.setAttribute("aria-pressed", String(state.selectedUserId === user.id));
    marker.textContent = String(user.id).slice(-2);
    marker.title = `${user.name} · ${user.connected ? user.apId : "Disconnected"} · ${user.rssiDbm === null ? "Signal unavailable" : user.rssiDbm + " dBm"}`;
    marker.addEventListener("click", () => {
      state.selectedUserId = user.id;
      state.selectedApId = null;
      renderDashboard();
    });
    marker.addEventListener("pointerdown", (event) => beginDrag(event, user));
    elements.mapNodes.append(marker);
  }
}

function renderApList(metrics) {
  elements.apList.replaceChildren();
  elements.apListCount.textContent = String(metrics.accessPoints.length);
  for (const ap of metrics.accessPoints) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.selectedApId === ap.id));
    const name = document.createElement("span");
    name.className = "ap-name";
    const indicator = document.createElement("i");
    indicator.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = ap.id;
    name.append(indicator, label);
    const load = document.createElement("span");
    load.textContent = `${ap.clientCount} clients · ${formatNumber(ap.utilizationPercent)}%`;
    button.append(name, load);
    button.addEventListener("click", () => {
      state.selectedApId = ap.id;
      state.selectedUserId = null;
      renderDashboard();
    });
    item.append(button);
    elements.apList.append(item);
  }
}

function renderSelection(metrics) {
  const selectedUser = metrics.users.find((user) => user.id === state.selectedUserId);
  const selectedAp = metrics.accessPoints.find((ap) => ap.id === state.selectedApId);
  elements.emptySelection.hidden = Boolean(selectedUser || selectedAp);
  elements.studentDetails.hidden = !selectedUser;
  elements.apDetails.hidden = !selectedAp;
  elements.removeStudentButton.disabled = !selectedUser;

  if (selectedUser) {
    elements.detailStudentName.textContent = selectedUser.name;
    elements.detailConnection.textContent = selectedUser.connected ? `Connected · ${selectedUser.apId}` : "Disconnected";
    elements.detailNearestAp.textContent = selectedUser.nearestApId || "No access points";
    elements.detailSignal.textContent = selectedUser.rssiDbm === null
      ? "Unavailable · No access points"
      : `${selectedUser.rssiDbm} dBm · ${capitalize(selectedUser.signalQuality)}`;
    elements.detailSignal.dataset.quality = selectedUser.signalQuality;
    elements.detailDistance.textContent = selectedUser.distance === null ? "—" : `${formatNumber(selectedUser.distance)} map units`;
    elements.detailPosition.textContent = `${formatNumber(selectedUser.x)}, ${formatNumber(selectedUser.y)}`;
    elements.detailDemand.textContent = `${formatNumber(selectedUser.demandMbps)} Mbps`;
    elements.mapHint.textContent = `${selectedUser.name} selected · drag to move`;
    return;
  }

  if (selectedAp) {
    elements.detailApName.textContent = `${selectedAp.id} · ${selectedAp.name}`;
    elements.detailApClients.textContent = `${selectedAp.clientCount}`;
    elements.detailApUtilization.textContent = `${formatNumber(selectedAp.utilizationPercent)}% · ${capitalize(selectedAp.condition)}`;
    elements.detailApCapacity.textContent = `${formatNumber(selectedAp.demandMbps)} / ${formatNumber(selectedAp.capacityMbps)} Mbps`;
    elements.detailApSignal.textContent = selectedAp.averageSignalDbm === null
      ? "No connected clients"
      : `${selectedAp.averageSignalDbm} dBm average`;
    elements.detailApPosition.textContent = `${formatNumber(selectedAp.x)}, ${formatNumber(selectedAp.y)}`;
    elements.mapHint.textContent = `${selectedAp.id} selected · estimated coverage shown on map`;
    return;
  }
  elements.mapHint.textContent = "Click an open area to place a student, or use the controls.";
}

function renderHistory(history) {
  elements.historyChart.replaceChildren();
  if (!history.length) {
    elements.historyCurrent.textContent = "—";
    elements.historyEmpty.hidden = false;
    elements.historyLabels.firstElementChild.textContent = "—";
    elements.historyLabels.lastElementChild.textContent = "—";
    return;
  }

  const points = history.slice(-24);
  const values = points.map((item) => Number(item.utilizationPercent));
  const maximum = Math.max(100, ...values);
  const ceiling = Math.ceil(maximum / 25) * 25 || 100;
  const timestamps = points.map((point) => new Date(point.recordedAt).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const duration = latest - earliest;
  const padding = { left: 42, right: 14, top: 9, bottom: 38 };
  const width = 720;
  const height = 170;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  [0, 0.5, 1].forEach((fraction) => {
    const y = padding.top + chartHeight * fraction;
    const line = svgElement("line", {
      x1: padding.left, y1: y, x2: width - padding.right, y2: y, class: "chart-grid"
    });
    elements.historyChart.append(line);
    const label = svgElement("text", {
      x: padding.left - 7, y: y + 3, "text-anchor": "end", class: "chart-label"
    });
    label.textContent = `${Math.round(ceiling * (1 - fraction))}%`;
    elements.historyChart.append(label);
  });

  const axisY = padding.top + chartHeight;
  elements.historyChart.append(svgElement("line", {
    x1: padding.left, y1: axisY, x2: width - padding.right, y2: axisY, class: "chart-axis"
  }));
  const coordinates = points.map((point, index) => {
    const value = Number(point.utilizationPercent);
    const timestamp = timestamps[index];
    const timePosition = duration > 0
      ? (timestamp - earliest) / duration
      : points.length > 1 ? index / (points.length - 1) : 0.5;
    const x = padding.left + chartWidth * timePosition;
    const y = padding.top + chartHeight * (1 - Math.max(0, value) / ceiling);
    return { x, y, point, timestamp, value };
  });
  const line = svgElement("polyline", {
    points: coordinates.map(({ x, y }) => `${x},${y}`).join(" "),
    class: "chart-line"
  });
  elements.historyChart.append(line);

  for (const coordinate of coordinates) {
    const circle = svgElement("circle", {
      cx: coordinate.x,
      cy: coordinate.y,
      r: 3,
      class: "chart-point"
    });
    const title = svgElement("title");
    title.textContent = `${formatTimestamp(coordinate.point.recordedAt)}: ${formatNumber(coordinate.value)}% utilization`;
    circle.append(title);
    elements.historyChart.append(circle);
  }

  elements.historyCurrent.textContent = `${formatNumber(Number(points[points.length - 1].utilizationPercent))}%`;
  elements.historyEmpty.hidden = true;
  const axisLabels = elements.historyLabels.children;
  const labelPositions = [0, 0.5, 1];
  labelPositions.forEach((fraction, index) => {
    const labelTime = earliest + duration * fraction;
    axisLabels[index].textContent = formatTimestamp(labelTime, duration >= 86400000);
    axisLabels[index].title = new Date(labelTime).toLocaleString();
  });
}

function beginDrag(event, user) {
  if (event.button !== 0 || !state.metrics) return;
  event.preventDefault();
  const marker = event.currentTarget;
  marker.setPointerCapture(event.pointerId);
  state.selectedUserId = user.id;
  state.selectedApId = null;
  state.drag = {
    pointerId: event.pointerId,
    marker,
    user,
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  };
  marker.addEventListener("pointermove", moveStudent);
  marker.addEventListener("pointerup", finishDrag, { once: true });
  marker.addEventListener("pointercancel", finishDrag, { once: true });
  renderSelection(state.metrics);
}

function moveStudent(event) {
  const drag = state.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const bounds = elements.campusMap.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / bounds.width * 100, 1, 99);
  const y = clamp((event.clientY - bounds.top) / bounds.height * 100, 1, 99);
  drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3;
  drag.user.x = x;
  drag.user.y = y;
  drag.marker.style.left = `${x}%`;
  drag.marker.style.top = `${y}%`;
}

async function finishDrag(event) {
  const drag = state.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  state.drag = null;
  drag.marker.removeEventListener("pointermove", moveStudent);
  if (!drag.moved) return;
  elements.mapHint.textContent = "Saving updated position…";
  await performAction("Student position saved.", () => requestJson(`/api/users/${drag.user.id}/position`, {
    method: "PATCH",
    body: JSON.stringify({ x: roundCoordinate(drag.user.x), y: roundCoordinate(drag.user.y) })
  }));
}

async function addStudent(position) {
  const body = position
    ? JSON.stringify({ x: roundCoordinate(position.x), y: roundCoordinate(position.y) })
    : "{}";
  await performAction("Student added and metrics recalculated.", () => requestJson("/api/users", {
    method: "POST",
    body
  }));
}

async function removeSelectedStudent() {
  if (state.selectedUserId === null) return;
  const id = state.selectedUserId;
  await performAction("Student removed and metrics recalculated.", () => requestJson(`/api/users/${id}`, {
    method: "DELETE"
  }));
}

async function resetSimulation() {
  await performAction("Simulation reset. Historical observations were retained.", () => requestJson("/api/reset", {
    method: "POST",
    body: "{}"
  }));
}

async function performAction(successMessage, action) {
  elements.addStudentButton.disabled = true;
  elements.removeStudentButton.disabled = true;
  try {
    await action();
    state.selectedUserId = null;
    state.selectedApId = null;
    await loadDashboard();
    showNotice(successMessage, true);
  } catch (error) {
    await loadDashboard();
    showNotice(error.message);
  } finally {
    if (state.metrics) {
      elements.addStudentButton.disabled = state.metrics.userCount >= state.campus.maxUsers;
      elements.removeStudentButton.disabled = state.selectedUserId === null;
    }
  }
}

function showNotice(message, success = false) {
  window.clearTimeout(state.noticeTimer);
  elements.notice.hidden = false;
  elements.notice.textContent = message;
  elements.notice.classList.toggle("notice-success", success);
  if (success) {
    state.noticeTimer = window.setTimeout(hideNotice, 3500);
  }
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.classList.remove("notice-success");
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatTimestamp(value, includeDate = false) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : includeDate
      ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : "—";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

elements.addStudentButton.addEventListener("click", () => addStudent());
elements.removeStudentButton.addEventListener("click", removeSelectedStudent);
elements.resetButton.addEventListener("click", resetSimulation);
elements.campusMap.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  const bounds = elements.campusMap.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / bounds.width * 100, 1, 99);
  const y = clamp((event.clientY - bounds.top) / bounds.height * 100, 1, 99);
  addStudent({ x, y });
});

loadDashboard();
