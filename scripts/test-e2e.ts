import WebSocket from "ws";

const PORT = process.argv[2] || "5182";
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;

async function createSession(): Promise<{ sessionId: string; token: string }> {
  const resp = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: "test" })
  });
  return await resp.json() as { sessionId: string; token: string };
}

function sendChat(ws: WebSocket, text: string): Promise<{ texts: string[]; toolCalls: string[] }> {
  return new Promise((resolve) => {
    const texts: string[] = [];
    const toolCalls: string[] = [];
    let textBuffer = "";

    const msgId = "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const body = JSON.stringify({
      messages: [{ id: msgId, role: "user", parts: [{ type: "text", text }] }],
      trigger: "submit-message"
    });

    ws.send(JSON.stringify({
      type: "cf_agent_use_chat_request",
      id: msgId,
      init: { method: "POST", body }
    }));

    const timer = setTimeout(() => {
      if (textBuffer) texts.push(textBuffer);
      resolve({ texts, toolCalls });
    }, 12000);

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type !== "cf_agent_use_chat_response") return;
        const inner = JSON.parse(parsed.body);
        
        if (inner.type === "text-delta") textBuffer += inner.delta || "";
        if (inner.type === "text-end") {
          if (textBuffer) { texts.push(textBuffer); textBuffer = ""; }
        }
        if (inner.type === "tool-input-start" && inner.toolName) toolCalls.push(inner.toolName);
        if (inner.type === "finish" || (inner.type === "end" && parsed.done)) {
          clearTimeout(timer);
          if (textBuffer) texts.push(textBuffer);
          resolve({ texts, toolCalls });
        }
      } catch { /* not JSON */ }
    });
  });
}

async function testScenario(name: string, message: string): Promise<{ texts: string[]; toolCalls: string[] }> {
  const { sessionId, token } = await createSession();
  const wsUrl = `${WS_BASE}/agents/support-session/${sessionId}?token=${token}`;
  
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", async () => {
      const result = await sendChat(ws, message);
      console.log(`\n=== ${name} ===`);
      console.log(`User: ${message}`);
      console.log(`AI: ${result.texts.join(" ").trim() || "(no text)"}`);
      console.log(`Tools: ${result.toolCalls.join(", ") || "none"}`);
      console.log(`Status: ${result.texts.length > 0 || result.toolCalls.length > 0 ? "PASS" : "FAIL"}`);
      ws.close();
      resolve(result);
    });
    ws.on("error", () => resolve({ texts: [], toolCalls: [] }));
    setTimeout(() => { ws.close(); resolve({ texts: [], toolCalls: [] }); }, 18000);
  });
}

async function main() {
  console.log(`Testing against port ${PORT}`);
  const scenarios: [string, string][] = [
    ["Bluetooth (supported)", "my bluetooth stopped working on ubuntu 24.04 after waking from sleep, headphones wont connect"],
    ["Disk space (supported)", "how to check my free disk space on ubuntu"],
    ["Billing (off-topic)", "I want a refund for my order, the product was damaged"],
    ["Password reset (off-topic)", "I forgot my email password and need to reset it"],
    ["Cracked screen (unsupported)", "my laptop screen is physically cracked"],
    ["WiFi (supported)", "wifi keeps disconnecting on windows 11 every few minutes"],
    ["npm not found (dev tool)", "npm command not found when I try to install a package on ubuntu"],
    ["Vague issue", "something is wrong with my computer"],
  ];

  let pass = 0;
  for (const [name, msg] of scenarios) {
    const result = await testScenario(name, msg);
    if (result.texts.length > 0 || result.toolCalls.length > 0) pass++;
    await new Promise(r => setTimeout(r, 3000));
  }
  
  console.log(`\n\n=== SUMMARY: ${pass}/${scenarios.length} passed ===`);
  process.exit(0);
}

main().catch(console.error);
