"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");
const { MemoryRepository } = require("../test-support/memory-repository");
const { MySqlRepository } = require("../database");

test("snapshot MySQL queries escape the reserved condition alias and preserve response keys", async () => {
  const queries = [];
  const pool = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(sql, parameters) {
          queries.push({ sql, parameters });
          return [{ insertId: 17 }];
        },
        async commit() {},
        async rollback() {},
        release() {}
      };
    },
    async execute(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.includes("WHERE id = ?")) {
        return [[{
          id: 17,
          userCount: 2,
          connectedUserCount: 2,
          totalDemandMbps: 24,
          totalCapacityMbps: 240,
          utilizationPercent: 10,
          averageSignalDbm: -60,
          condition: "normal",
          recordedAt: "2026-10-16T00:00:00.000Z"
        }]];
      }
      return [[{
        id: 17,
        userCount: 2,
        connectedUserCount: 2,
        totalDemandMbps: 24,
        totalCapacityMbps: 240,
        utilizationPercent: 10,
        averageSignalDbm: -60,
        condition: "normal",
        recordedAt: "2026-10-16T00:00:00.000Z"
      }]];
    }
  };
  const repository = new MySqlRepository(pool);
  const metrics = {
    userCount: 2,
    connectedUserCount: 2,
    totalDemandMbps: 24,
    totalCapacityMbps: 240,
    utilizationPercent: 10,
    averageSignalDbm: -60,
    condition: "normal",
    accessPoints: []
  };

  const saved = await repository.recordSnapshot(metrics);
  const history = await repository.getSnapshotHistory(10);
  const snapshotQueries = queries.filter(({ sql }) => sql.includes("FROM simulation_snapshots"));

  assert.equal(snapshotQueries.length, 2);
  assert.ok(snapshotQueries.every(({ sql }) => sql.includes("condition_name AS `condition`")));
  assert.equal(saved.condition, "normal");
  assert.equal(history[0].condition, "normal");
});

async function withServer(callback) {
  const repository = new MemoryRepository();
  const server = createApp(repository).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(baseUrl, repository);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function jsonRequest(baseUrl, url, options) {
  const response = await fetch(`${baseUrl}${url}`, options);
  return { response, payload: await response.json() };
}

test("existing status endpoint and application assets remain available", async () => {
  await withServer(async (baseUrl) => {
    const status = await jsonRequest(baseUrl, "/api/status");
    assert.equal(status.response.status, 200);
    assert.equal(status.payload.project, "Smart Campus Digital Twin");
    assert.equal(status.payload.status, "Backend Connected");
    assert.equal(status.payload.simulation, true);
    assert.equal(status.response.headers.get("cache-control"), "no-store");

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Wireless coverage map/);
    assert.equal((await fetch(`${baseUrl}/server.js`)).status, 404);
  });
});

test("REST user add, move, remove, and reset persist timestamped calculated snapshots", async () => {
  await withServer(async (baseUrl, repository) => {
    let result = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Learner", x: 20, y: 20 })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.payload.user.name, "Learner");
    assert.equal(result.payload.user.apId, "AP-01");
    assert.equal(result.payload.metrics.totalDemandMbps, 12);

    result = await jsonRequest(baseUrl, `/api/users/${result.payload.user.id}/position`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 80, y: 80 })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.user.apId, "AP-02");
    assert.deepEqual([repository.users[0].x, repository.users[0].y], [80, 80]);

    const reloadedState = await jsonRequest(baseUrl, "/api/metrics");
    assert.equal(reloadedState.payload.users[0].name, "Learner");
    assert.equal(reloadedState.payload.utilizationPercent, 5);

    result = await jsonRequest(baseUrl, `/api/users/${repository.users[0].id}`, { method: "DELETE" });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.metrics.userCount, 0);
    assert.equal(result.payload.metrics.averageSignalDbm, null);

    await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 20, y: 20 })
    });
    result = await jsonRequest(baseUrl, "/api/reset", { method: "POST" });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.metrics.userCount, 0);
    assert.equal(repository.history.length, 5);

    const history = await jsonRequest(baseUrl, "/api/simulation/history?limit=3");
    assert.equal(history.payload.length, 3);
    assert.equal(history.payload[2].userCount, 0);
    assert.ok(history.payload[0].recordedAt);
  });
});

test("campus and AP configuration updates are validated and persisted", async () => {
  await withServer(async (baseUrl, repository) => {
    let result = await jsonRequest(baseUrl, "/api/campus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Engineering Campus", defaultDemandMbps: 18 })
    });
    assert.equal(result.response.status, 200);
    assert.equal(repository.campus.name, "Engineering Campus");
    assert.equal(repository.campus.defaultDemandMbps, 18);

    result = await jsonRequest(baseUrl, "/api/access-points/AP-01", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 25, y: 30, capacityMbps: 80 })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.accessPoint.capacityMbps, 80);
    assert.equal(repository.history.length, 1);

    for (const [url, body] of [
      ["/api/users", { x: -1, y: 20 }],
      ["/api/users", { x: 10 }],
      ["/api/users", { x: 10, y: 10, extra: true }],
      ["/api/campus", { maxUsers: 121 }],
      ["/api/access-points/AP-01", { x: 3 }]
    ]) {
      const invalid = await jsonRequest(baseUrl, url, {
        method: url === "/api/users" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(invalid.response.status, 400, `${url} should reject ${JSON.stringify(body)}`);
      assert.equal(typeof invalid.payload.error, "string");
    }

    assert.equal((await jsonRequest(baseUrl, "/api/users/999/position", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1, y: 1 })
    })).response.status, 404);
    assert.equal((await jsonRequest(baseUrl, "/api/simulation/history?limit=500")).response.status, 400);
    assert.equal((await jsonRequest(baseUrl, "/api/not-a-route")).response.status, 404);
  });
});

test("user limit, malformed JSON, and request errors have explicit HTTP responses", async () => {
  await withServer(async (baseUrl) => {
    for (let index = 0; index < 3; index += 1) {
      const created = await jsonRequest(baseUrl, "/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Student ${index}`, x: 20, y: 20 })
      });
      assert.equal(created.response.status, 201);
    }
    const full = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(full.response.status, 409);

    const malformed = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /valid JSON/);
  });
});
