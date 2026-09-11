import { getAllScripts } from "../server/library/index";

export function generateSitemap(baseUrl: string): string {
  const scripts = getAllScripts();
  const urls = [`${baseUrl}/`, `${baseUrl}/library`, `${baseUrl}/privacy`];
  for (const script of scripts) {
    urls.push(`${baseUrl}/library/${encodeURIComponent(script.id)}`);
  }
  const lastmod = new Date().toISOString().split("T")[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}
</urlset>`;
}
