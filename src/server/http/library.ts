import { getAllScripts, getScript, getFlows } from "../library/index";

export function handleLibraryRequest(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/library" && request.method === "GET") {
    return new Response(
      JSON.stringify({
        entries: getAllScripts(),
        flows: getFlows()
      }),
      {
        headers: { "content-type": "application/json" }
      }
    );
  }

  const idMatch = path.match(/^\/api\/library\/(.+)$/);
  if (idMatch && request.method === "GET") {
    const id = decodeURIComponent(idMatch[1]);
    const script = getScript(id);
    if (!script) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify(script), {
      headers: { "content-type": "application/json" }
    });
  }

  return null;
}
