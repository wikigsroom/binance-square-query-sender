process.env.API_PROXY_TARGET = "http://127.0.0.1:4321";
const { createServer } = await import("vite");
const server = await createServer({
  server: { host: "127.0.0.1", port: 4300, strictPort: true },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void server.close().then(() => process.exit(0)));
