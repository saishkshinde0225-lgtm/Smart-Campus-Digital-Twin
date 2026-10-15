"use strict";

const MAX_MAP_COORDINATE = 100;
const DEFAULT_DEMAND_MBPS = 12;
const MAX_CLIENTS = 120;
const SIGNAL_REFERENCE_DBM = -50;
const PATH_LOSS_EXPONENT = 2;
const MAX_COVERAGE_DISTANCE = 56.2;

function getSignalEstimate(distance) {
  const safeDistance = Math.max(distance, 1);
  const rssiDbm = SIGNAL_REFERENCE_DBM - (10 * PATH_LOSS_EXPONENT * Math.log10(safeDistance));
  let quality;

  if (rssiDbm >= -55) quality = "excellent";
  else if (rssiDbm >= -67) quality = "good";
  else if (rssiDbm >= -75) quality = "fair";
  else if (rssiDbm >= -85) quality = "weak";
  else quality = "disconnected";

  return {
    rssiDbm: Math.round(rssiDbm),
    quality,
    connected: distance <= MAX_COVERAGE_DISTANCE
  };
}

function calculateDistance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function calculateMetrics(users, accessPoints) {
  const accessPointMetrics = accessPoints.map((ap) => ({
    ...ap,
    clientCount: 0,
    signalTotalDbm: 0,
    demandMbps: 0,
    utilizationPercent: 0,
    condition: "available"
  }));

  const measuredUsers = users.map((user) => {
    let nearestIndex = -1;
    let shortestDistance = Infinity;

    accessPointMetrics.forEach((ap, index) => {
      const distance = calculateDistance(user.x, user.y, ap.x, ap.y);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestIndex = index;
      }
    });

    const ap = accessPointMetrics[nearestIndex];
    const signal = ap
      ? getSignalEstimate(shortestDistance)
      : { rssiDbm: null, quality: "disconnected", connected: false };
    const connected = Boolean(ap) && signal.connected;

    if (connected) {
      ap.clientCount += 1;
      ap.signalTotalDbm += signal.rssiDbm;
      ap.demandMbps += Number(user.demandMbps);
    }

    return {
      ...user,
      x: Number(user.x),
      y: Number(user.y),
      demandMbps: Number(user.demandMbps),
      apId: connected ? ap.id : null,
      nearestApId: ap ? ap.id : null,
      distance: ap && Number.isFinite(shortestDistance) ? Number(shortestDistance.toFixed(2)) : null,
      rssiDbm: signal.rssiDbm,
      signalQuality: signal.quality,
      connected
    };
  });

  accessPointMetrics.forEach((ap) => {
    ap.capacityMbps = Number(ap.capacityMbps);
    ap.x = Number(ap.x);
    ap.y = Number(ap.y);
    ap.averageSignalDbm = ap.clientCount
      ? Math.round(ap.signalTotalDbm / ap.clientCount)
      : null;
    delete ap.signalTotalDbm;
    ap.demandMbps = Number(ap.demandMbps.toFixed(2));
    ap.utilizationPercent = ap.capacityMbps > 0
      ? Number((100 * ap.demandMbps / ap.capacityMbps).toFixed(1))
      : 0;
    ap.condition = ap.utilizationPercent >= 100
      ? "congested"
      : ap.utilizationPercent >= 70
        ? "busy"
        : "available";
  });

  const connectedUsers = measuredUsers.filter((user) => user.connected);
  const totalDemandMbps = accessPointMetrics.reduce((sum, ap) => sum + ap.demandMbps, 0);
  const totalCapacityMbps = accessPointMetrics.reduce((sum, ap) => sum + ap.capacityMbps, 0);
  const utilizationPercent = totalCapacityMbps > 0
    ? Number((100 * totalDemandMbps / totalCapacityMbps).toFixed(1))
    : 0;
  const busiestAccessPointUtilizationPercent = accessPointMetrics.reduce(
    (maximum, ap) => Math.max(maximum, ap.utilizationPercent),
    0
  );
  const averageSignalDbm = connectedUsers.length
    ? Math.round(connectedUsers.reduce((sum, user) => sum + user.rssiDbm, 0) / connectedUsers.length)
    : null;

  return {
    userCount: users.length,
    connectedUserCount: connectedUsers.length,
    accessPointCount: accessPoints.length,
    totalDemandMbps: Number(totalDemandMbps.toFixed(2)),
    totalCapacityMbps: Number(totalCapacityMbps.toFixed(2)),
    utilizationPercent,
    averageSignalDbm,
    busiestAccessPointUtilizationPercent,
    condition: busiestAccessPointUtilizationPercent >= 100
      ? "congested"
      : busiestAccessPointUtilizationPercent >= 70
        ? "busy"
        : "normal",
    users: measuredUsers,
    accessPoints: accessPointMetrics
  };
}

module.exports = {
  DEFAULT_DEMAND_MBPS,
  MAX_CLIENTS,
  MAX_COVERAGE_DISTANCE,
  MAX_MAP_COORDINATE,
  calculateDistance,
  calculateMetrics,
  getSignalEstimate
};
