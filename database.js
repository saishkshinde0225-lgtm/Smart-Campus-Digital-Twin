"use strict";

class MySqlRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getCampus() {
    const [rows] = await this.pool.execute(
      "SELECT id, name, description, map_width AS mapWidth, map_height AS mapHeight, default_demand_mbps AS defaultDemandMbps, max_users AS maxUsers FROM campuses WHERE id = ?",
      ["main-campus"]
    );
    return rows[0] || null;
  }

  async updateCampus(patch) {
    const columns = {
      name: "name",
      description: "description",
      defaultDemandMbps: "default_demand_mbps",
      maxUsers: "max_users"
    };
    const updates = Object.entries(patch)
      .filter(([key]) => columns[key])
      .map(([key]) => `${columns[key]} = ?`);

    if (updates.length) {
      const values = Object.entries(patch)
        .filter(([key]) => columns[key])
        .map(([, value]) => value);
      await this.pool.execute(
        `UPDATE campuses SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, "main-campus"]
      );
    }

    return this.getCampus();
  }

  async getAccessPoints() {
    const [rows] = await this.pool.execute(
      "SELECT id, name, x, y, capacity_mbps AS capacityMbps FROM access_points WHERE campus_id = ? ORDER BY id",
      ["main-campus"]
    );
    return rows.map((ap) => ({
      ...ap,
      x: Number(ap.x),
      y: Number(ap.y),
      capacityMbps: Number(ap.capacityMbps)
    }));
  }

  async updateAccessPoint(id, patch) {
    const current = (await this.getAccessPoints()).find((ap) => ap.id === id);
    if (!current) return null;

    await this.pool.execute(
      "UPDATE access_points SET x = ?, y = ?, capacity_mbps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND campus_id = ?",
      [
        patch.x === undefined ? current.x : patch.x,
        patch.y === undefined ? current.y : patch.y,
        patch.capacityMbps === undefined ? current.capacityMbps : patch.capacityMbps,
        id,
        "main-campus"
      ]
    );
    return (await this.getAccessPoints()).find((ap) => ap.id === id) || null;
  }

  async getUsers() {
    const [rows] = await this.pool.execute(
      "SELECT id, name, x, y, demand_mbps AS demandMbps, created_at AS createdAt, updated_at AS updatedAt FROM campus_users WHERE campus_id = ? ORDER BY id",
      ["main-campus"]
    );
    return rows.map((user) => ({
      ...user,
      id: Number(user.id),
      x: Number(user.x),
      y: Number(user.y),
      demandMbps: Number(user.demandMbps)
    }));
  }

  async createUser(user) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        "INSERT INTO campus_users (campus_id, name, x, y, demand_mbps) VALUES (?, ?, ?, ?, ?)",
        ["main-campus", user.name || "Student", user.x, user.y, user.demandMbps]
      );
      const id = Number(result.insertId);
      if (!user.name) {
        await connection.execute("UPDATE campus_users SET name = ? WHERE id = ?", [`Student ${id}`, id]);
      }
      await connection.commit();
      const [rows] = await this.pool.execute(
        "SELECT id, name, x, y, demand_mbps AS demandMbps, created_at AS createdAt, updated_at AS updatedAt FROM campus_users WHERE id = ?",
        [id]
      );
      const saved = rows[0];
      return {
        ...saved,
        id: Number(saved.id),
        x: Number(saved.x),
        y: Number(saved.y),
        demandMbps: Number(saved.demandMbps)
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateUserPosition(id, x, y) {
    await this.pool.execute(
      "UPDATE campus_users SET x = ?, y = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND campus_id = ?",
      [x, y, id, "main-campus"]
    );
    return (await this.getUsers()).find((user) => user.id === id) || null;
  }

  async deleteUser(id) {
    const [result] = await this.pool.execute(
      "DELETE FROM campus_users WHERE id = ? AND campus_id = ?",
      [id, "main-campus"]
    );
    return result.affectedRows > 0;
  }

  async deleteUsers() {
    await this.pool.execute("DELETE FROM campus_users WHERE campus_id = ?", ["main-campus"]);
  }

  async recordSnapshot(metrics) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        "INSERT INTO simulation_snapshots (campus_id, user_count, connected_user_count, total_demand_mbps, total_capacity_mbps, utilization_percent, average_signal_dbm, condition_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          "main-campus",
          metrics.userCount,
          metrics.connectedUserCount,
          metrics.totalDemandMbps,
          metrics.totalCapacityMbps,
          metrics.utilizationPercent,
          metrics.averageSignalDbm,
          metrics.condition
        ]
      );
      for (const ap of metrics.accessPoints) {
        await connection.execute(
          "INSERT INTO snapshot_access_points (snapshot_id, access_point_id, client_count, demand_mbps, capacity_mbps, utilization_percent) VALUES (?, ?, ?, ?, ?, ?)",
          [result.insertId, ap.id, ap.clientCount, ap.demandMbps, ap.capacityMbps, ap.utilizationPercent]
        );
      }
      await connection.commit();
      const [rows] = await this.pool.execute(
        "SELECT id, user_count AS userCount, connected_user_count AS connectedUserCount, total_demand_mbps AS totalDemandMbps, total_capacity_mbps AS totalCapacityMbps, utilization_percent AS utilizationPercent, average_signal_dbm AS averageSignalDbm, condition_name AS `condition`, created_at AS recordedAt FROM simulation_snapshots WHERE id = ?",
        [result.insertId]
      );
      return rows[0];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSnapshotHistory(limit) {
    const [rows] = await this.pool.execute(
      "SELECT id, user_count AS userCount, connected_user_count AS connectedUserCount, total_demand_mbps AS totalDemandMbps, total_capacity_mbps AS totalCapacityMbps, utilization_percent AS utilizationPercent, average_signal_dbm AS averageSignalDbm, condition_name AS `condition`, created_at AS recordedAt FROM simulation_snapshots WHERE campus_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      ["main-campus", limit]
    );
    return rows.reverse();
  }
}

module.exports = { MySqlRepository };
