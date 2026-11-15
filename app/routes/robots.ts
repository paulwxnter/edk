export function loader() {
  const body = `User-agent: *
Allow: /
Disallow: /console/
Disallow: /login
Disallow: /sign-up

Sitemap: https://edk.earth/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
