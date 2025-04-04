import client from "axios";
import {
  addHours,
  addMinutes,
  addSeconds,
  differenceInMinutes,
  differenceInSeconds,
  formatDate,
  isAfter,
  isWithinInterval,
  set,
  setDate,
  startOfDay,
  subHours,
} from "date-fns";
import sqlite3 from "sqlite3";
import cron from "node-cron";
import express from "express";
import { CLIENT_HEADER, STOPS } from "./const.js";
import {
  NEW_TRACKED_BUS_QUERY,
  ACTIVE_TRACKED_BUS_QUERY,
  ARRIVAL_TRACKED_BUS_QUERY,
  COMPLETED_TRACKED_BUS_QUERY,
  UPDATE_TRACKED_BUS_QUERY,
  COMPLETED_TRACKED_BUS_BY_ROUTE_QUERY,
  DISABLE_TRACKED_BUS_QUERY,
  TRACKED_BUS_BY_ID_QUERY,
  UNRELIABLE_TRACKED_BUS_QUERY,
  RESET_TRACKED_BUS_QUERY,
  UPDATE_DEPARTURE_TRACKED_BUS_QUERY,
} from "./queries.js";
import { Server } from "socket.io";
import { createServer } from "node:http";
import cors from "cors";
import { Database } from "./db.js";

const app = express();
app.use(express.json());
app.use(cors());

const server = createServer(app);

server.listen(5100, () => {
  logger(`Server is listening on port 5100`);
});

const io = new Server(server, {
  transports: ["websocket"],
});

const db = new Database(process.env.DB);

db.init();

io.on("connection", (socket) => {
  logger("SESSION - New session started: " + socket.id);

  socket.on("disconnect", () => {
    logger("SESSION - Session disconnected by client: " + socket.id);
  });
});

client.defaults.headers.common = CLIENT_HEADER;

export const logger = (log) => {
  io.emit("console_event", { payload: log });
  console.log(log);
};

const stopAndWait = (time) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

function generateTimeSlots() {
  const slots = [];
  let start = startOfDay(new Date(0)).toISOString();

  for (let i = 0; i < 24; i++) {
    let end = addHours(start, 1).toISOString();
    slots.push({
      start,
      end,
    });
    start = end;
  }

  return slots;
}

const getTotalLegTime = (start, end) => {
  if (!start || !end) return 0;
  return differenceInMinutes(start, end);
};

export const fetchBusDepartures = async (stops) => {
  for (const stopID of stops) {
    try {
      const { data: busesInStop } = await client.get(
        `https://servizi.cotralspa.it:4444/mw-travelCotralBE/v1/stop/palina?id=${stopID}&delta=10`
      );

      let buses = busesInStop.payload.corsa ?? [];

      buses = buses?.filter(
        (bus) =>
          // ["PI8A", "PI20A", "PI20D", "PI8D"].includes(bus.percorso) &&
          bus.soppressa == "N"
      );

      if (buses.length == 0) continue;

      logger("INFO - Fetching data for stop ID " + stopID.toUpperCase());

      for (const corsa of buses) {
        const update = await db.getOne(NEW_TRACKED_BUS_QUERY, [
          corsa.idCorsa + formatDate(new Date(), "yyyyMMdd"),
          corsa.idCorsa,
          corsa.partenzaCorsa,
          corsa.arrivoCorsa,
          corsa.instradamento,
          corsa.soppressa != "N",
          corsa.percorso,
        ]);

        if (update) {
          logger("INFO - Adding " + update.bus_id + " to tracking queue");
          io.emit("new_act_tracking", { ...update });
        }
      }
    } catch (error) {
      logger(JSON.stringify(error));
    }
  }
  fetchBusStatus(await db.getAll(ACTIVE_TRACKED_BUS_QUERY));
};

export const fetchBusStatus = async (trackedBuses, manual = false) => {
  const startTime = new Date().getTime();
  try {
    if (trackedBuses.length == 0) {
      logger("INFO - Tracking queue is empty. Skipping update job");
      return;
    }

    logger("UPDATING - Fetching updates for " + trackedBuses.length + " buses");

    for (const row of trackedBuses) {
      try {
        const { data: busData } = await client.get(
          "https://servizi.cotralspa.it:4444/mw-travelCotralBE/v1/route/ride?id=" +
            row.bus_id
        );

        if (busData.payload.automezzo.stato != "AVM") {
          const connectionUpdate = await db.getOne(DISABLE_TRACKED_BUS_QUERY, [
            row.uid,
          ]);
          logger(
            "ISSUE - Connection with bus " +
              row.bus_id +
              " lost. Tracking has stopped."
          );
          if (connectionUpdate && !manual)
            io.emit("rm_act_tracking", { ...connectionUpdate });
          continue;
        }

        const intermediateStopInterval = Math.floor(
          parseInt(busData.payload.fermate.fermata.length) / 4
        );

        const stops = busData.payload.fermate.fermata.map((stop) => {
          if (stop.passato == "0") return { ...stop, PR: null };
          return stop;
        });

        const incrementalUpdate = await db.getOne(UPDATE_TRACKED_BUS_QUERY, [
          stops.at(0)?.PR
            ? addSeconds(
                startOfDay(new Date()),
                parseInt(stops.at(0)?.PR)
              ).toISOString()
            : null,
          stops.at(intermediateStopInterval * 1)?.PR
            ? addSeconds(
                startOfDay(new Date()),
                parseInt(stops.at(intermediateStopInterval * 1)?.PR)
              ).toISOString()
            : null,
          stops.at(intermediateStopInterval * 2)?.PR
            ? addSeconds(
                startOfDay(new Date()),
                parseInt(stops.at(intermediateStopInterval * 2)?.PR)
              ).toISOString()
            : null,
          stops.at(intermediateStopInterval * 3)?.PR
            ? addSeconds(
                startOfDay(new Date()),
                parseInt(stops.at(intermediateStopInterval * 3)?.PR)
              ).toISOString()
            : null,
          row.uid,
        ]);

        if (incrementalUpdate && !manual)
          io.emit("update_act_tracking", { ...incrementalUpdate });

        const lastStopIndex = parseInt(
          busData.payload.fermate.fermata.length - 1
        );

        const secondToLastStopIndex = parseInt(
          busData.payload.fermate.fermata.length - 2
        );

        if (
          stops.at(lastStopIndex)?.PR ||
          stops.at(secondToLastStopIndex)?.PR
        ) {
          const { departure } = incrementalUpdate;

          if (!departure) {
            const disableUpdate = await db.getOne(DISABLE_TRACKED_BUS_QUERY, [
              row.uid,
            ]);

            if (disableUpdate && !manual)
              io.emit("rm_act_tracking", { ...disableUpdate });

            logger(
              "ISSUE - Bus " +
                row.bus_id +
                " has incomplete data. Tracking has stopped."
            );

            continue;
          }
          const arrivalTimestamp = addSeconds(
            startOfDay(new Date()),
            parseInt(
              stops.at(lastStopIndex)?.PR ?? stops.at(secondToLastStopIndex)?.PR
            )
          ).toISOString();

          const isDepartureAfterArrival = isAfter(departure, arrivalTimestamp);

          const isArrivalInFuture = isAfter(
            arrivalTimestamp,
            addMinutes(new Date(), 10)
          );

          if (isArrivalInFuture || isDepartureAfterArrival) {
            const unreliableUpdate = await db.getOne(
              UNRELIABLE_TRACKED_BUS_QUERY,
              [row.uid]
            );

            if (unreliableUpdate && !manual)
              io.emit("update_act_tracking", { ...unreliableUpdate });

            if (isDepartureAfterArrival)
              logger(
                "ISSUE - Bus " +
                  row.bus_id +
                  " departure date is after the arrival date, and has been flagged as unreliable"
              );

            if (isArrivalInFuture)
              logger(
                "ISSUE - Bus " +
                  row.bus_id +
                  " arrival date is in more than 10 minutes from now, and has been flagged as unreliable"
              );
          }

          const arrivalUpdate = await db.getOne(ARRIVAL_TRACKED_BUS_QUERY, [
            arrivalTimestamp,
            row.uid,
          ]);

          if (arrivalUpdate && !manual) {
            io.emit("rm_act_tracking", { ...arrivalUpdate });
            io.emit("new_comp_tracking", { ...arrivalUpdate });
          }

          logger(
            "COMPLETED - Bus ID " + row.bus_id + " has reached its destination"
          );
        }
      } catch (fetchError) {
        logger(JSON.stringify(fetchError));
      }
      if (!manual)
        await stopAndWait(Math.floor((1000 * 140) / trackedBuses.length));
    }

    logger(
      "UPDATING - Update for " +
        trackedBuses.length +
        " buses completed in " +
        (new Date().getTime() - startTime)
    );
  } catch (error) {
    logger(JSON.stringify(error));
  }
};

app.get("/tracking/active", async (req, res) => {
  try {
    const data = await db.getAll(ACTIVE_TRACKED_BUS_QUERY, []);
    return res.json({ payload: data });
  } catch (error) {
    logger(JSON.stringify(error));
  }
});

app.get("/tracking/all", async (req, res) => {
  try {
    const data = await db.getAll(COMPLETED_TRACKED_BUS_QUERY, []);
    return res.json(
      data.map((row) => {
        return {
          ...row,

          calculated_travel_time: {
            total_travel_time: getTotalLegTime(row.arrival, row.departure),
            first_leg_travel_time: getTotalLegTime(
              row.intermediate_1,
              row.departure
            ),
            second_leg_travel_time: getTotalLegTime(
              row.intermediate_2,
              row.intermediate_1
            ),
            third_leg_travel_time: getTotalLegTime(
              row.intermediate_3,
              row.intermediate_2
            ),
            final_leg_travel_time: getTotalLegTime(
              row.arrival,
              row.intermediate_3
            ),
          },
        };
      })
    );
  } catch (error) {
    logger(JSON.stringify(error));
  }
});

app.get("/tracking/avg/:route", async (req, res) => {
  try {
    const data = await db.getAll(COMPLETED_TRACKED_BUS_BY_ROUTE_QUERY, [
      req.params.route,
    ]);

    if (data.length == 0) return res.status(400).json("No data available");

    let timeframes = {};
    for (const timeframe of generateTimeSlots()) {
      const timeframeStartPoint = timeframe.start;

      timeframes[timeframeStartPoint] = {
        average_run_time: 0,
        average_run_quantity: 0,
        total_run_time: 0,
        average_suppression_rate: 0,
        sample_size: 0,
      };

      const busesInTimeframe = data.filter((row) => {
        const parsedDate = set(row.departure, {
          year: 1970,
          month: 0,
          date: 1,
        });

        return isWithinInterval(parsedDate, timeframe);
      });

      for (const run of busesInTimeframe) {
        const legDuration = getTotalLegTime(run.arrival, run.departure);
        if (legDuration <= 0) continue;
        timeframes[timeframeStartPoint].sample_size += 1;
        timeframes[timeframeStartPoint].total_run_time = Math.floor(
          timeframes[timeframeStartPoint].total_run_time + legDuration
        );
      }
    }

    for (const slot in timeframes) {
      if (timeframes[slot].total_run_time != 0)
        timeframes[slot].average_run_time =
          timeframes[slot].total_run_time / timeframes[slot].sample_size;
    }
    return res.json(timeframes);
  } catch (error) {
    logger(JSON.stringify(error));
  }
});

app.get("/tracking/util/:id", async (req, res) => {
  try {
    const bus_id = req.params.id;

    const { data: busData } = await client.get(
      "https://servizi.cotralspa.it:4444/mw-travelCotralBE/v1/route/ride?id=" +
        bus_id
    );

    if (!busData.payload)
      return res.status(400).json("Cannot retrieve data for this ID");

    return res.json(busData.payload);
  } catch (error) {
    logger(JSON.stringify(error));
  }
});

app.patch("/tracking/util/:id", async (req, res) => {
  try {
    const uid = req.params.id;

    logger("INFO - Launching manual data update on bus " + uid);

    await db.getOne(RESET_TRACKED_BUS_QUERY, [uid]);

    fetchBusStatus([await db.getOne(TRACKED_BUS_BY_ID_QUERY, [uid])], true);

    return res.json("Update concluded for bus id " + uid);
  } catch (error) {
    logger(JSON.stringify(error));
  }
});

cron.schedule("*/3 * * * *", () => {
  fetchBusDepartures(STOPS);
});
