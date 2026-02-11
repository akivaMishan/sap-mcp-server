package io.github.akivamishan.adtbridge;

import java.io.IOException;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import com.google.gson.JsonObject;

public class HealthHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // CORS preflight
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, OPTIONS");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            BridgeHttpServer.sendResponse(exchange, 405,
                "{\"error\":\"Method not allowed\"}");
            return;
        }

        JsonObject response = new JsonObject();
        response.addProperty("status", "ok");
        response.addProperty("plugin", "io.github.akivamishan.adtbridge");
        response.addProperty("version", "1.0.0");

        // Check if we can find an ADT project
        AdtConnectionManager connMgr = AdtConnectionManager.getInstance();
        String projectStatus = connMgr.getProjectStatus();
        response.addProperty("project", projectStatus);

        BridgeHttpServer.sendResponse(exchange, 200, response.toString());
    }
}
