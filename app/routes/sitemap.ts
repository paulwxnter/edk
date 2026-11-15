const BASE_URL = "https://edk.earth";

const publicPages = ["/", "/model", "/elements", "/map", "/map/visual", "/map/permits", "/map/traffic-accidents", "/map/community-issues", "/map/crime", "/signals", "/pricing", "/docs", "/agents", "/contact", "/brand"];

export function loader() {
  const urls = publicPages.map((path) => `  <url><loc>${BASE_URL}${path}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
