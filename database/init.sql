CREATE DATABASE IF NOT EXISTS smart_campus_twin
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smart_campus_twin;

CREATE TABLE IF NOT EXISTS campuses (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  map_width SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  map_height SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  default_demand_mbps DECIMAL(7,2) NOT NULL DEFAULT 12.00,
  max_users SMALLINT UNSIGNED NOT NULL DEFAULT 120,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_campus_map_width CHECK (map_width > 0),
  CONSTRAINT chk_campus_map_height CHECK (map_height > 0),
  CONSTRAINT chk_campus_demand CHECK (default_demand_mbps > 0),
  CONSTRAINT chk_campus_max_users CHECK (max_users BETWEEN 1 AND 120)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS access_points (
  id VARCHAR(16) PRIMARY KEY,
  campus_id VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  x DECIMAL(5,2) NOT NULL,
  y DECIMAL(5,2) NOT NULL,
  capacity_mbps DECIMAL(9,2) NOT NULL DEFAULT 120.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_access_points_campus FOREIGN KEY (campus_id)
    REFERENCES campuses (id) ON DELETE CASCADE,
  CONSTRAINT chk_access_points_x CHECK (x BETWEEN 0 AND 100),
  CONSTRAINT chk_access_points_y CHECK (y BETWEEN 0 AND 100),
  CONSTRAINT chk_access_points_capacity CHECK (capacity_mbps > 0),
  INDEX idx_access_points_campus (campus_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campus_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campus_id VARCHAR(40) NOT NULL,
  name VARCHAR(48) NOT NULL,
  x DECIMAL(5,2) NOT NULL,
  y DECIMAL(5,2) NOT NULL,
  demand_mbps DECIMAL(7,2) NOT NULL DEFAULT 12.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_campus FOREIGN KEY (campus_id)
    REFERENCES campuses (id) ON DELETE CASCADE,
  CONSTRAINT chk_users_x CHECK (x BETWEEN 0 AND 100),
  CONSTRAINT chk_users_y CHECK (y BETWEEN 0 AND 100),
  CONSTRAINT chk_users_demand CHECK (demand_mbps > 0),
  INDEX idx_users_campus (campus_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS simulation_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campus_id VARCHAR(40) NOT NULL,
  user_count SMALLINT UNSIGNED NOT NULL,
  connected_user_count SMALLINT UNSIGNED NOT NULL,
  total_demand_mbps DECIMAL(10,2) NOT NULL,
  total_capacity_mbps DECIMAL(10,2) NOT NULL,
  utilization_percent DECIMAL(8,2) NOT NULL,
  average_signal_dbm SMALLINT NULL,
  condition_name VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_snapshots_campus FOREIGN KEY (campus_id)
    REFERENCES campuses (id) ON DELETE CASCADE,
  INDEX idx_snapshots_campus_time (campus_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS snapshot_access_points (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  access_point_id VARCHAR(16) NOT NULL,
  client_count SMALLINT UNSIGNED NOT NULL,
  demand_mbps DECIMAL(10,2) NOT NULL,
  capacity_mbps DECIMAL(9,2) NOT NULL,
  utilization_percent DECIMAL(8,2) NOT NULL,
  PRIMARY KEY (snapshot_id, access_point_id),
  CONSTRAINT fk_snapshot_aps_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES simulation_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshot_aps_ap FOREIGN KEY (access_point_id)
    REFERENCES access_points (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO campuses (id, name, description, map_width, map_height, default_demand_mbps, max_users)
VALUES ('main-campus', 'North Campus', 'Wireless network planning simulation', 100, 100, 12.00, 120)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO access_points (id, campus_id, name, x, y, capacity_mbps)
VALUES
  ('AP-01', 'main-campus', 'Science West', 22, 25, 120),
  ('AP-02', 'main-campus', 'Library North', 76, 24, 120),
  ('AP-03', 'main-campus', 'Dining South', 25, 75, 120),
  ('AP-04', 'main-campus', 'Engineering East', 76, 74, 120)
ON DUPLICATE KEY UPDATE id = VALUES(id);
