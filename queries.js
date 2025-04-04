export const NEW_TRACKED_BUS_QUERY =
  "INSERT OR IGNORE INTO buses (uid, bus_id, origin, destination, via, suppressed, route) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *";

export const ACTIVE_TRACKED_BUS_QUERY = `SELECT * FROM buses WHERE suppressed = 0 AND (departure IS NULL OR arrival IS NULL)`;

export const COMPLETED_TRACKED_BUS_BY_ROUTE_QUERY = `SELECT * FROM buses WHERE suppressed = 0 AND unreliable = 0 AND departure IS NOT NULL AND arrival IS NOT NULL AND route = ?`;

export const TRACKED_BUS_BY_ID_QUERY = `SELECT * FROM buses WHERE uid = ?`;

export const COMPLETED_TRACKED_BUS_QUERY = `SELECT * FROM buses WHERE suppressed = 0 AND departure IS NOT NULL AND arrival IS NOT NULL ORDER BY departure`;

export const UPDATE_DEPARTURE_TRACKED_BUS_QUERY = `UPDATE buses SET departure = ? WHERE uid = ? RETURNING *`;

export const UPDATE_TRACKED_BUS_QUERY = `UPDATE buses SET departure = ?, intermediate_1 = ?, intermediate_2 = ?, intermediate_3 = ? WHERE uid = ? RETURNING *`;

export const RESET_TRACKED_BUS_QUERY = `UPDATE buses SET departure = NULL, arrival = NULL, intermediate_1 = NULL, intermediate_2 = NULL, intermediate_3 = NULL, suppressed = 0, unreliable = 0 WHERE uid = ? RETURNING *`;

export const DISABLE_TRACKED_BUS_QUERY = `UPDATE buses SET SUPPRESSED = 1 WHERE uid = ? RETURNING *`;

export const UNRELIABLE_TRACKED_BUS_QUERY = `UPDATE buses SET unreliable = 1 WHERE uid = ? RETURNING *`;

export const ARRIVAL_TRACKED_BUS_QUERY = `UPDATE buses SET arrival = ? WHERE uid = ? RETURNING *`;
