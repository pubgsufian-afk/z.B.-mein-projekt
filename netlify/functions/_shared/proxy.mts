const FALLBACK_ORIGIN = "https://6a6c6533a553914a3e6e9a53--habun-mitarbeiterportal.netlify.app";

const forwardedHeaders = (request: Request, origin: string) => {
  const headers = new Headers(request.headers);
  for (const name of ["connection", "content-length", "host", "transfer-encoding", "x-forwarded-host", "x-forwarded-proto"]) {
    headers.delete(name);
  }
  headers.set("x-habun-ui-version", "premium-main");
  headers.set("origin", origin);
  headers.set("referer", `${origin}/`);
  return headers;
};

export async function proxyToProductionBackend(request: Request, pathname: string): Promise<Response> {
  const origin = Netlify.env.get("PRODUCTION_BACKEND_ORIGIN") || FALLBACK_ORIGIN;
  const incoming = new URL(request.url);
  const upstream = new URL(pathname + incoming.search, origin);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  const response = await fetch(upstream, {
    method: request.method,
    headers: forwardedHeaders(request, origin),
    body,
    redirect: "manual"
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Robots-Tag", "noindex");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}
