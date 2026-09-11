import WebSocket from "ws";

const URL =
  process.argv[2] ?? "ws://localhost:5173/agents/support-session/test";
const NUM_CLIENTS = parseInt(process.argv[3] ?? "10", 10);
const DELAY_MS = 100;

async function main() {
  console.log(`Load test: ${NUM_CLIENTS} clients against ${URL}`);
  const clients: WebSocket[] = [];
  let connected = 0;
  let messages = 0;
  let errors = 0;

  for (let i = 0; i < NUM_CLIENTS; i++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    try {
      const ws = new WebSocket(URL + "?token=load-test");
      ws.on("open", () => {
        connected++;
      });
      ws.on("message", () => {
        messages++;
      });
      ws.on("error", () => {
        errors++;
      });
      ws.on("close", () => {
        connected--;
      });
      clients.push(ws);
    } catch {
      errors++;
    }
  }

  await new Promise((r) => setTimeout(r, 5000));
  console.log(
    `Connected: ${connected}, Messages: ${messages}, Errors: ${errors}`
  );
  for (const ws of clients) ws.close();
  process.exit(0);
}

main().catch(console.error);
