"use strict";

class MemoryRepository {
  constructor() {
    this.campus = {
      id: "main-campus",
      name: "Test Campus",
      description: "",
      mapWidth: 100,
      mapHeight: 100,
      defaultDemandMbps: 12,
      maxUsers: 3
    };
    this.accessPoints = [
      { id: "AP-01", name: "North", x: 20, y: 20, capacityMbps: 120 },
      { id: "AP-02", name: "South", x: 80, y: 80, capacityMbps: 120 }
    ];
    this.users = [];
    this.history = [];
    this.nextId = 1;
  }

  async getCampus() { return { ...this.campus }; }
  async updateCampus(patch) { Object.assign(this.campus, patch); return this.getCampus(); }
  async getAccessPoints() { return this.accessPoints.map((ap) => ({ ...ap })); }
  async updateAccessPoint(id, patch) {
    const ap = this.accessPoints.find((item) => item.id === id);
    if (!ap) return null;
    Object.assign(ap, patch);
    return { ...ap };
  }
  async getUsers() { return this.users.map((user) => ({ ...user })); }
  async createUser(user) {
    const id = this.nextId++;
    const saved = { id, ...user, name: user.name || `Student ${id}` };
    this.users.push(saved);
    return { ...saved };
  }
  async updateUserPosition(id, x, y) {
    const user = this.users.find((item) => item.id === id);
    if (!user) return null;
    user.x = x;
    user.y = y;
    return { ...user };
  }
  async deleteUser(id) {
    const index = this.users.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.users.splice(index, 1);
    return true;
  }
  async deleteUsers() { this.users = []; }
  async recordSnapshot(metrics) {
    const snapshot = {
      id: this.history.length + 1,
      userCount: metrics.userCount,
      connectedUserCount: metrics.connectedUserCount,
      totalDemandMbps: metrics.totalDemandMbps,
      totalCapacityMbps: metrics.totalCapacityMbps,
      utilizationPercent: metrics.utilizationPercent,
      averageSignalDbm: metrics.averageSignalDbm,
      condition: metrics.condition,
      recordedAt: new Date(Date.now() + this.history.length).toISOString()
    };
    this.history.push(snapshot);
    return { ...snapshot };
  }
  async getSnapshotHistory(limit) { return this.history.slice(-limit).map((item) => ({ ...item })); }
}

module.exports = { MemoryRepository };
