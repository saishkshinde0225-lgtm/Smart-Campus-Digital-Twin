"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_DEMAND_MBPS,
  MAX_COVERAGE_DISTANCE,
  calculateMetrics,
  getSignalEstimate
} = require("../simulation");

const accessPoints = [
  { id: "AP-01", name: "West", x: 10, y: 10, capacityMbps: 120 },
  { id: "AP-02", name: "East", x: 90, y: 90, capacityMbps: 120 }
];

test("signal estimates use distance thresholds and modeled coverage", () => {
  assert.deepEqual(getSignalEstimate(1), { rssiDbm: -50, quality: "excellent", connected: true });
  assert.equal(getSignalEstimate(10).rssiDbm, -70);
  assert.equal(getSignalEstimate(10).quality, "fair");
  assert.equal(getSignalEstimate(MAX_COVERAGE_DISTANCE).connected, true);
  assert.equal(getSignalEstimate(MAX_COVERAGE_DISTANCE + 1).connected, false);
  assert.equal(getSignalEstimate(600).quality, "disconnected");
});

test("client demand is assigned to nearest AP and utilization uses configured capacity", () => {
  const result = calculateMetrics([
    { id: 1, name: "A", x: 11, y: 10, demandMbps: DEFAULT_DEMAND_MBPS },
    { id: 2, name: "B", x: 89, y: 90, demandMbps: 24 }
  ], accessPoints);

  assert.equal(result.userCount, 2);
  assert.equal(result.connectedUserCount, 2);
  assert.equal(result.accessPointCount, 2);
  assert.equal(result.totalDemandMbps, 36);
  assert.equal(result.totalCapacityMbps, 240);
  assert.equal(result.utilizationPercent, 15);
  assert.deepEqual(result.accessPoints.map((ap) => ap.clientCount), [1, 1]);
  assert.deepEqual(result.accessPoints.map((ap) => ap.demandMbps), [12, 24]);
  assert.deepEqual(result.users.map((user) => user.apId), ["AP-01", "AP-02"]);
});

test("empty and out-of-coverage networks do not report fabricated signal or traffic", () => {
  const empty = calculateMetrics([], accessPoints);
  assert.equal(empty.userCount, 0);
  assert.equal(empty.connectedUserCount, 0);
  assert.equal(empty.averageSignalDbm, null);
  assert.equal(empty.utilizationPercent, 0);

  const disconnected = calculateMetrics([
    { id: 3, name: "Remote", x: 50, y: 50, demandMbps: 12 }
  ], [{ id: "AP-01", name: "West", x: 0, y: 0, capacityMbps: 120 }]);
  assert.equal(disconnected.userCount, 1);
  assert.equal(disconnected.connectedUserCount, 0);
  assert.equal(disconnected.users[0].apId, null);
  assert.equal(disconnected.users[0].nearestApId, "AP-01");
  assert.equal(disconnected.totalDemandMbps, 0);

  const withoutAccessPoints = calculateMetrics([
    { id: 4, name: "Unserved", x: 50, y: 50, demandMbps: 12 }
  ], []);
  assert.equal(withoutAccessPoints.users[0].rssiDbm, null);
  assert.equal(withoutAccessPoints.users[0].distance, null);
  assert.equal(withoutAccessPoints.users[0].signalQuality, "disconnected");
});

test("AP utilization reports busy and overloaded conditions", () => {
  const users = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    name: `User ${index + 1}`,
    x: 10,
    y: 10,
    demandMbps: 12
  }));
  const result = calculateMetrics(users, [accessPoints[0]]);
  assert.equal(result.utilizationPercent, 110);
  assert.equal(result.condition, "congested");
  assert.equal(result.accessPoints[0].condition, "congested");
});
