"use strict";

require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const path = require("node:path");
const { MySqlRepository } = require("./database");
const {
  DEFAULT_DEMAND_MBPS,
  MAX_CLIENTS,
  MAX_MAP_COORDINATE,
  calculateMetrics
} = require("./simulation");

const APP_ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateCoordinate(value, field) {
  if (!isFiniteNumber(value) || value < 0 || value > MAX_MAP_COORDINATE) {
    throw new HttpError(400, `${field} must be a number from 0 to ${MAX_MAP_COORDINATE}.`);
  }
}

function validateDemand(value, field = "demandMbps") {
  if (!isFiniteNumber(value) || value < 0.1 || value > 100) {
    throw new HttpError(400, `${field} must be a number from 0.1 to 100 Mbps.`);
  }
}

function validateFields(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !allowedFields.includes(key))) {
    throw new HttpError(400, `Provide one or more supported fields: ${allowedFields.join(", ")}.`);
  }
}

function validateClientInput(body) {
  const allowedFields = ["name", "x", "y", "demandMbps"];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !allowedFields.includes(key))) {
    throw new HttpError(400, `Request body must be an object containing only: ${allowedFields.join(", ")}.`);
  }
  if (body.name !== undefined
    && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 48)) {
    throw new HttpError(400, "name must contain 1 to 48 characters.");
  }
  if ((body.x === undefined) !== (body.y === undefined)) {
    throw new HttpError(400, "x and y must be provided together.");
  }
  if (body.x !== undefined) {
    validateCoordinate(body.x, "x");
    validateCoordinate(body.y, "y");
  }
  if (body.demandMbps !== undefined) validateDemand(body.demandMbps);
}

function createApp(repository) {
  if (!repository) throw new Error("A data repository must be provided.");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/", (req, res) => res.sendFile(path.join(APP_ROOT, "index.html")));
  app.get(["/style.css", "/script.js"], express.static(APP_ROOT));

  async function getState() {
    const [campus, accessPoints, users] = await Promise.all([
      repository.getCampus(),
      repository.getAccessPoints(),
      repository.getUsers()
    ]);
    if (!campus) throw new HttpError(500, "Campus configuration is missing. Run database/init.sql.");
    return { campus, ...calculateMetrics(users, accessPoints) };
  }

  async function writeSnapshot() {
    const metrics = await getState();
    return { metrics, snapshot: await repository.recordSnapshot(metrics) };
  }

  app.get("/api/status", (req, res) => {
    res.json({
      project: "Smart Campus Digital Twin",
      status: "Backend Connected",
      message: "Server is running successfully",
      simulation: true
    });
  });

  app.get("/api/campus", async (req, res) => {
    const campus = await repository.getCampus();
    if (!campus) throw new HttpError(404, "Campus configuration was not found.");
    res.json(campus);
  });

  app.patch("/api/campus", async (req, res) => {
    validateFields(req.body, ["name", "description", "defaultDemandMbps", "maxUsers"]);
    const patch = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (key === "name" || key === "description") {
        const maximum = key === "name" ? 80 : 255;
        if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
          throw new HttpError(400, `${key} must contain 1 to ${maximum} characters.`);
        }
        patch[key] = value.trim();
      } else if (key === "defaultDemandMbps") {
        validateDemand(value, key);
        patch[key] = value;
      } else {
        if (!Number.isInteger(value) || value < 1 || value > MAX_CLIENTS) {
          throw new HttpError(400, `maxUsers must be an integer from 1 to ${MAX_CLIENTS}.`);
        }
        patch[key] = value;
      }
    }
    res.json(await repository.updateCampus(patch));
  });

  app.get("/api/access-points", async (req, res) => {
    res.json((await getState()).accessPoints);
  });

  app.patch("/api/access-points/:id", async (req, res) => {
    validateFields(req.body, ["x", "y", "capacityMbps"]);
    if ((req.body.x === undefined) !== (req.body.y === undefined)) {
      throw new HttpError(400, "x and y must be updated together.");
    }
    if (req.body.x !== undefined) {
      validateCoordinate(req.body.x, "x");
      validateCoordinate(req.body.y, "y");
    }
    if (req.body.capacityMbps !== undefined
      && (!isFiniteNumber(req.body.capacityMbps) || req.body.capacityMbps < 1 || req.body.capacityMbps > 100000)) {
      throw new HttpError(400, "capacityMbps must be a number from 1 to 100000.");
    }
    const accessPoint = await repository.updateAccessPoint(req.params.id, req.body);
    if (!accessPoint) throw new HttpError(404, "Access point was not found.");
    const result = await writeSnapshot();
    res.json({ accessPoint, ...result });
  });

  app.get("/api/users", async (req, res) => {
    res.json((await getState()).users);
  });

  app.post("/api/users", async (req, res) => {
    validateClientInput(req.body);
    const campus = await repository.getCampus();
    if (!campus) throw new HttpError(404, "Campus configuration was not found.");
    const users = await repository.getUsers();
    if (users.length >= campus.maxUsers) {
      throw new HttpError(409, `The configured limit of ${campus.maxUsers} students has been reached.`);
    }
    const user = await repository.createUser({
      name: req.body.name === undefined ? null : req.body.name.trim(),
      x: req.body.x === undefined ? Math.round(5 + Math.random() * 90) : req.body.x,
      y: req.body.y === undefined ? Math.round(7 + Math.random() * 86) : req.body.y,
      demandMbps: req.body.demandMbps === undefined
        ? Number(campus.defaultDemandMbps || DEFAULT_DEMAND_MBPS)
        : req.body.demandMbps
    });
    const result = await writeSnapshot();
    res.status(201).json({
      user: result.metrics.users.find((entry) => entry.id === user.id),
      ...result
    });
  });

  app.patch("/api/users/:id/position", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "User id must be a positive integer.");
    validateFields(req.body, ["x", "y"]);
    if (Object.keys(req.body).length !== 2 || !("x" in req.body) || !("y" in req.body)) {
      throw new HttpError(400, "Both x and y coordinates are required.");
    }
    validateCoordinate(req.body.x, "x");
    validateCoordinate(req.body.y, "y");
    if (!await repository.updateUserPosition(id, req.body.x, req.body.y)) {
      throw new HttpError(404, "Student was not found.");
    }
    const result = await writeSnapshot();
    res.json({ user: result.metrics.users.find((entry) => entry.id === id), ...result });
  });

  app.delete("/api/users/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "User id must be a positive integer.");
    if (!await repository.deleteUser(id)) throw new HttpError(404, "Student was not found.");
    res.json(await writeSnapshot());
  });

  app.get("/api/metrics", async (req, res) => {
    res.json(await getState());
  });

  app.post("/api/simulation/snapshots", async (req, res) => {
    if (req.body && Object.keys(req.body).length) {
      throw new HttpError(400, "Snapshot requests do not accept a request body.");
    }
    res.status(201).json(await writeSnapshot());
  });

  app.get("/api/simulation/history", async (req, res) => {
    const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new HttpError(400, "limit must be an integer from 1 to 100.");
    }
    res.json(await repository.getSnapshotHistory(limit));
  });

  app.post("/api/reset", async (req, res) => {
    if (req.body && Object.keys(req.body).length) {
      throw new HttpError(400, "Reset requests do not accept a request body.");
    }
    await repository.deleteUsers();
    res.json(await writeSnapshot());
  });

  app.use((req, res) => res.status(404).json({ error: "Route not found." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return res.status(400).json({ error: "Request body must contain valid JSON." });
    }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
    if (status >= 500) console.error("Request failed:", error);
    return res.status(status).json({
      error: status === 500 ? "An internal server error occurred." : error.message
    });
  });
  return app;
}

async function startServer() {
  const required = ["DB_HOST", "DB_USER", "DB_NAME"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true
  });

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw new Error(`Unable to connect to MySQL (${error.message}). Check .env and run database/init.sql.`);
  }

  const app = createApp(new MySqlRepository(pool));
  const server = app.listen(PORT, () => {
    console.log(`Smart Campus Digital Twin listening at http://localhost:${PORT}`);
  });
  const shutdown = () => {
    server.close(() => {
      pool.end().then(() => process.exit(0)).catch((error) => {
        console.error("Failed to close MySQL pool:", error);
        process.exit(1);
      });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { app, pool, server };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer, validateClientInput };
