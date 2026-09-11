import { Agent } from "agents";
import {
  CoordinatorLogic,
  createCoordinatorData,
  type CoordinatorData
} from "./coordinator-logic";

const ALARM_INTERVAL_MS = 60 * 1000;

export class Coordinator extends Agent<Env, CoordinatorData> {
  maxStateTtl = 24 * 60 * 60 * 1000;
  private logic: CoordinatorLogic | null = null;

  onStart() {
    if (!this.state.sessions) this.state.sessions = {};
    if (!this.state.queue) this.state.queue = [];
    if (!this.state.ipCounts) this.state.ipCounts = {};
    this.logic = new CoordinatorLogic(this.state, {
      maxActive: this.env.MAX_ACTIVE_SESSIONS
        ? parseInt(this.env.MAX_ACTIVE_SESSIONS, 10)
        : undefined
    });
    this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  private getLogic(): CoordinatorLogic {
    if (!this.logic) {
      if (!this.state.sessions) this.state.sessions = {};
      if (!this.state.queue) this.state.queue = [];
      if (!this.state.ipCounts) this.state.ipCounts = {};
      this.logic = new CoordinatorLogic(this.state, {
        maxActive: this.env.MAX_ACTIVE_SESSIONS
          ? parseInt(this.env.MAX_ACTIVE_SESSIONS, 10)
          : undefined
      });
    }
    return this.logic;
  }

  async alarm() {
    this.getLogic().sweepIdle();
    this.ctx.storage.put("sessions", this.state.sessions);
    this.ctx.storage.put("queue", this.state.queue);
    if (
      this.getLogic().activeCount() > 0 ||
      this.getLogic().queuedCount() > 0
    ) {
      this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  admit(
    { ipHash }: { ipHash: string },
    sessionId?: string,
    maxActive?: number
  ) {
    const logic = this.getLogic();
    if (maxActive) logic.maxActive = maxActive;
    const result = logic.admit({ ipHash }, sessionId);
    this.ctx.storage.put("sessions", this.state.sessions);
    this.ctx.storage.put("queue", this.state.queue);
    return result;
  }

  heartbeat(sessionId: string) {
    this.getLogic().heartbeat(sessionId);
    this.ctx.storage.put("sessions", this.state.sessions);
  }

  release(sessionId: string) {
    this.getLogic().release(sessionId);
    this.ctx.storage.put("sessions", this.state.sessions);
    this.ctx.storage.put("queue", this.state.queue);
  }

  checkQueue(ticket: string) {
    const result = this.getLogic().checkQueue(ticket);
    if (result.status === "admitted") {
      this.ctx.storage.put("sessions", this.state.sessions);
      this.ctx.storage.put("queue", this.state.queue);
    }
    return result;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/coordinator/health") {
      return new Response(
        JSON.stringify({
          active: this.getLogic().activeCount(),
          queued: this.getLogic().queuedCount()
        }),
        { headers: { "content-type": "application/json" } }
      );
    }
    return new Response("Not found", { status: 404 });
  }
}

export { CoordinatorLogic, createCoordinatorData };
export type { CoordinatorData };
