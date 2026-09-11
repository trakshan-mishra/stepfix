import { Agent } from "agents";
import {
  CoordinatorLogic,
  createCoordinatorData,
  type CoordinatorData,
  type ModelQuota,
  type KillSwitches
} from "./coordinator-logic";

const ALARM_INTERVAL_MS = 60 * 1000;

function ensureState(state: CoordinatorData | undefined): CoordinatorData {
  if (!state || !state.sessions) {
    return createCoordinatorData();
  }
  if (!state.quotas) state.quotas = {};
  if (!state.killSwitches) {
    state.killSwitches = {
      disabledProviders: [],
      disabledModels: [],
      forceDegraded: false,
      admissionsPaused: false
    };
  }
  return state;
}

export class Coordinator extends Agent<Env, CoordinatorData> {
  maxStateTtl = 24 * 60 * 60 * 1000;
  private logic: CoordinatorLogic | null = null;

  onStart() {
    const data = ensureState(this.state);
    this.setState(data);
    this.logic = new CoordinatorLogic(data, {
      maxActive: this.env.MAX_ACTIVE_SESSIONS
        ? parseInt(this.env.MAX_ACTIVE_SESSIONS, 10)
        : undefined
    });
    this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  private getLogic(): CoordinatorLogic {
    if (!this.logic) {
      const data = ensureState(this.state);
      this.setState(data);
      this.logic = new CoordinatorLogic(data, {
        maxActive: this.env.MAX_ACTIVE_SESSIONS
          ? parseInt(this.env.MAX_ACTIVE_SESSIONS, 10)
          : undefined
      });
    }
    return this.logic;
  }

  async alarm() {
    this.getLogic().sweepIdle();
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
    return result;
  }

  heartbeat(sessionId: string) {
    this.getLogic().heartbeat(sessionId);
  }

  release(sessionId: string) {
    this.getLogic().release(sessionId);
  }

  checkQueue(ticket: string) {
    return this.getLogic().checkQueue(ticket);
  }

  getAllQuotas(): Record<string, ModelQuota> {
    return this.getLogic().getAllQuotas();
  }

  getKillSwitches(): KillSwitches {
    return this.getLogic().getKillSwitches();
  }

  disableProvider(provider: string): void {
    this.getLogic().disableProvider(provider);
  }

  enableProvider(provider: string): void {
    this.getLogic().enableProvider(provider);
  }

  disableModel(key: string): void {
    this.getLogic().disableModel(key);
  }

  enableModel(key: string): void {
    this.getLogic().enableModel(key);
  }

  forceDegraded(value: boolean): void {
    this.getLogic().forceDegraded(value);
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
export type { CoordinatorData, ModelQuota, KillSwitches };
