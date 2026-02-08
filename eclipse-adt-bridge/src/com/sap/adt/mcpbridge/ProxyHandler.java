package com.sap.adt.mcpbridge;

import java.io.IOException;
import java.util.Map;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

public class ProxyHandler implements HttpHandler {

    private static final Gson gson = new Gson();

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // CORS preflight
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            BridgeHttpServer.sendResponse(exchange, 405,
                "{\"error\":\"Method not allowed. Use POST.\"}");
            return;
        }

        try {
            String requestBody = BridgeHttpServer.readRequestBody(exchange.getRequestBody());
            JsonObject request = gson.fromJson(requestBody, JsonObject.class);

            // Extract proxy request fields
            String method = getStringField(request, "method", "GET");
            String path = getStringField(request, "path", null);

            if (path == null || path.isEmpty()) {
                BridgeHttpServer.sendResponse(exchange, 400,
                    "{\"error\":\"Missing required field: path\"}");
                return;
            }

            String body = getStringField(request, "body", null);

            // Extract headers
            JsonObject headersObj = request.has("headers") ?
                request.getAsJsonObject("headers") : null;
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            if (headersObj != null) {
                for (Map.Entry<String, JsonElement> entry : headersObj.entrySet()) {
                    headers.put(entry.getKey(), entry.getValue().getAsString());
                }
            }

            // Extract query params
            JsonObject paramsObj = request.has("params") ?
                request.getAsJsonObject("params") : null;
            java.util.Map<String, String> params = new java.util.HashMap<>();
            if (paramsObj != null) {
                for (Map.Entry<String, JsonElement> entry : paramsObj.entrySet()) {
                    params.put(entry.getKey(), entry.getValue().getAsString());
                }
            }

            Activator.log("Proxy request: " + method + " " + path);

            // Execute through Eclipse ADT
            AdtConnectionManager connMgr = AdtConnectionManager.getInstance();
            AdtConnectionManager.ProxyResponse proxyResponse =
                connMgr.executeRequest(method, path, headers, params, body);

            // Build response
            JsonObject responseJson = new JsonObject();
            responseJson.addProperty("status", proxyResponse.status);

            JsonObject responseHeaders = new JsonObject();
            if (proxyResponse.headers != null) {
                for (Map.Entry<String, String> entry : proxyResponse.headers.entrySet()) {
                    responseHeaders.addProperty(entry.getKey(), entry.getValue());
                }
            }
            responseJson.add("headers", responseHeaders);
            responseJson.addProperty("body", proxyResponse.body != null ? proxyResponse.body : "");

            BridgeHttpServer.sendResponse(exchange, 200, responseJson.toString());

        } catch (Exception e) {
            Activator.logError("Proxy request failed", e);
            JsonObject errorResponse = new JsonObject();
            errorResponse.addProperty("status", 500);
            errorResponse.addProperty("error", e.getMessage());
            errorResponse.add("headers", new JsonObject());
            errorResponse.addProperty("body", "");
            BridgeHttpServer.sendResponse(exchange, 200, errorResponse.toString());
        }
    }

    private String getStringField(JsonObject obj, String field, String defaultValue) {
        if (obj.has(field) && !obj.get(field).isJsonNull()) {
            return obj.get(field).getAsString();
        }
        return defaultValue;
    }
}
