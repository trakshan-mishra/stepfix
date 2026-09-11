declare module "ws" {
  export default class WebSocket {
    constructor(url: string, options?: Record<string, unknown>);
    on(event: string, listener: (...args: unknown[]) => void): this;
    close(): void;
    send(data: string): void;
    readonly readyState: number;
  }
}
