# Wireless Network Digital Twin — Smart Campus

A compact campus wireless-planning demonstrator built with HTML, CSS, browser JavaScript, Node.js, Express, and MySQL. Client positions and configuration are persisted in MySQL. This application is a software simulation: signal, traffic, and congestion are estimates, not measurements from Wi-Fi hardware.

## Windows setup

### Requirements

- Windows 10/11
- Node.js 18 or newer (Node.js 20 LTS recommended)
- MySQL Server 8.0 or newer, running locally

### Configure MySQL

Open PowerShell in the project folder and initialize the database from a MySQL account permitted to create a database:

```powershell
cmd.exe /c "mysql -u root -p < database\init.sql"
```

Enter the MySQL password when prompted. The script creates the `smart_campus_twin` database, its relational tables, one North Campus record, and four sample access points. It is safe to rerun: existing campus and AP configuration is preserved, and existing users and simulation history are not deleted.

If the MySQL command-line client is not on `PATH`, run the same command using its full path, for example:

```powershell
cmd.exe /c "`"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`" -u root -p < database\init.sql"
```

### Install and configure the app

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for your local MySQL account. The example uses the local `root` account; for shared deployments, use a dedicated MySQL account restricted to this database. Do not commit `.env`.

Start the application:

```powershell
npm start
```

Open <http://localhost:3000>. The app checks its MySQL connection during startup and reports an actionable error rather than silently switching to temporary storage. For automatic Node.js restarts during development, use `npm run dev`.

### Run tests

```powershell
npm test
```

The automated suite exercises the REST API with a test repository and verifies the simulation model, validation, add/move/remove/reset flows, snapshot history, and updated state on subsequent API reads. It does not require a running MySQL service.

## REST API

All request and response bodies use JSON. Coordinates are normalized campus map units from `0` to `100`. Invalid input returns a JSON `{ "error": "..." }` response with a 4xx status; missing resources return 404 and unexpected server/database errors return 500.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Existing backend status contract and simulation flag |
| `GET`, `PATCH` | `/api/campus` | Read or update campus name, description, default client demand, and maximum users |
| `GET` | `/api/access-points` | List configured APs with current client distribution and utilization |
| `PATCH` | `/api/access-points/:id` | Update an AP's paired `x`/`y` position and/or `capacityMbps` |
| `GET`, `POST` | `/api/users` | List simulated clients or create one (`name`, paired `x`/`y`, and `demandMbps` are optional) |
| `PATCH` | `/api/users/:id/position` | Move a client with required `x` and `y` |
| `DELETE` | `/api/users/:id` | Remove a client |
| `GET` | `/api/metrics` | Current derived campus, client, signal, and AP metrics |
| `POST` | `/api/simulation/snapshots` | Record a timestamped observation of current metrics |
| `GET` | `/api/simulation/history?limit=30` | Read up to 100 actual saved observations |
| `POST` | `/api/reset` | Remove all simulated clients and save the resulting observation; history is retained |

## Simulation model

- Coordinates are normalized map units, not metres. The straight-line distance between each client and AP is calculated with Euclidean distance.
- Estimated received signal uses a log-distance path-loss model: `RSSI (dBm) = -50 - 20 × log10(max(distance, 1))`. The reference is `-50 dBm` at one normalized map unit and the path-loss exponent is 2. This is a simplified free-space-style estimate and does not model walls, interference, antenna direction, or real transmit power.
- The nearest AP is selected by Euclidean distance. A client is counted as connected only within the modeled `56.2`-unit coverage radius (approximately `-85 dBm` under this formula). Signal labels are excellent (`≥ -55 dBm`), good (`≥ -67`), fair (`≥ -75`), weak (`≥ -85`), and disconnected (below `-85`).
- Each connected simulated client generates its configured traffic demand (12 Mbps by default). Traffic is assigned to that client's nearest AP. Per-AP load is assigned demand divided by AP capacity; campus utilization is total assigned demand divided by total configured AP capacity. Busy begins at 70%; congestion begins at 100%. Utilization can exceed 100% to show overload.
- A snapshot is persisted whenever clients are added, moved, or removed, AP capacity/position changes, or the simulation is reset. The graph plots these timestamped database observations; it does not invent or interpolate history.

## Database layout

`database/init.sql` creates `campuses`, `access_points`, `campus_users`, `simulation_snapshots`, and `snapshot_access_points`. Foreign keys keep campus and per-snapshot AP data consistent. The seed consists only of campus configuration and APs; it does not add pretend clients or historical observations.

## Limitations

- A running MySQL 8+ service and an initialized schema are required to start the application.
- Only one campus is seeded and exposed by this demonstration; campus map artwork is illustrative rather than a surveyed campus plan.
- Signal coverage is circular in normalized map coordinates and does not account for buildings, radio interference, roaming delays, or real Wi-Fi devices.
- Metrics update when a simulation action is made; there is no hardware polling or automatic background snapshot timer.
