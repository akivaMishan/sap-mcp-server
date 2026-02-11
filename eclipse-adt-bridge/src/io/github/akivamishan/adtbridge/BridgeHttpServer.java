package io.github.akivamishan.adtbridge;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import com.sun.net.httpserver.HttpServer;

public class BridgeHttpServer {

    private final int port;
    private HttpServer server;

    public BridgeHttpServer(int port) {
        this.port = port;
    }

    public void start() throws IOException {
        // Bind to 0.0.0.0 to allow connections from WSL2 (which uses a different network namespace)
        server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);

        server.createContext("/health", new HealthHandler());
        server.createContext("/proxy", new ProxyHandler());

        server.setExecutor(null); // default executor
        server.start();

        Activator.log("HTTP server listening on 127.0.0.1:" + port);
    }

    public void stop() {
        if (server != null) {
            server.stop(2);
            Activator.log("HTTP server stopped");
        }
    }

    static String readRequestBody(InputStream is) throws IOException {
        byte[] bytes = is.readAllBytes();
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void sendResponse(com.sun.net.httpserver.HttpExchange exchange,
                             int statusCode, String body) throws IOException {
        byte[] responseBytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, responseBytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(responseBytes);
        }
    }
}
