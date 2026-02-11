package io.github.akivamishan.adtbridge;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.runtime.NullProgressMonitor;

import com.sap.adt.communication.message.ByteArrayMessageBody;
import com.sap.adt.communication.message.HeadersFactory;
import com.sap.adt.communication.message.IHeaders;
import com.sap.adt.communication.message.IMessageBody;
import com.sap.adt.communication.resources.AdtRestResourceFactory;
import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.communication.resources.IRestResourceFactory;
import com.sap.adt.communication.resources.IRestResourceResponseFilter;
import com.sap.adt.communication.resources.IRestRequestContext;
import com.sap.adt.communication.resources.IRestResponseContext;
import com.sap.adt.communication.resources.ResourceException;
import com.sap.adt.project.IAdtCoreProject;

/**
 * Manages ADT connections and proxies requests through Eclipse's internal APIs.
 * All HTTP methods (GET, POST, PUT, DELETE) are proxied via REST resources.
 */
public class AdtConnectionManager {

    private static final AdtConnectionManager INSTANCE = new AdtConnectionManager();

    public static AdtConnectionManager getInstance() {
        return INSTANCE;
    }

    public static class ProxyResponse {
        public int status;
        public Map<String, String> headers;
        public String body;

        public ProxyResponse(int status, Map<String, String> headers, String body) {
            this.status = status;
            this.headers = headers;
            this.body = body;
        }
    }

    /**
     * Find the first ABAP project in the workspace.
     */
    private IAdtCoreProject findAdtProject() {
        IProject[] projects = ResourcesPlugin.getWorkspace().getRoot().getProjects();
        for (IProject project : projects) {
            if (project.isOpen()) {
                IAdtCoreProject adtProject = project.getAdapter(IAdtCoreProject.class);
                if (adtProject != null) {
                    return adtProject;
                }
            }
        }
        return null;
    }

    public String getProjectStatus() {
        try {
            IAdtCoreProject adtProject = findAdtProject();
            if (adtProject == null) {
                return "no_adt_project";
            }
            return "connected:" + adtProject.getDestinationId();
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    public ProxyResponse executeRequest(String method, String path,
            Map<String, String> requestHeaders, Map<String, String> params,
            String body) throws Exception {

        IAdtCoreProject adtProject = findAdtProject();
        if (adtProject == null) {
            throw new Exception("No ADT project found in workspace. " +
                "Open an ABAP project in Eclipse first.");
        }

        String destinationId = adtProject.getDestinationId();
        String upperMethod = method.toUpperCase();

        Activator.log("Request: " + upperMethod + " " + path);

        return executeViaRestResource(upperMethod, path, params, requestHeaders, body, destinationId);
    }

    /**
     * Execute request via REST resource (GET, POST, PUT, DELETE).
     */
    private ProxyResponse executeViaRestResource(String method, String path,
            Map<String, String> params, Map<String, String> requestHeaders,
            String body, String destinationId) throws Exception {

        // Build URI with query parameters
        StringBuilder uriStr = new StringBuilder(path);
        if (params != null && !params.isEmpty()) {
            uriStr.append(path.contains("?") ? "&" : "?");
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) uriStr.append("&");
                uriStr.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8));
                uriStr.append("=");
                uriStr.append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
                first = false;
            }
        }

        URI uri = URI.create(uriStr.toString());

        // Create REST resource with session
        IRestResourceFactory factory = AdtRestResourceFactory.createRestResourceFactory();
        IRestResource resource;

        // Use stateless sessions for GET to avoid auto-locking objects.
        // Use the enqueue session for POST/PUT/DELETE so that
        // LOCK → PUT → UNLOCK share the same session context.
        if ("GET".equals(method)) {
            resource = factory.createResourceWithStatelessSession(uri, destinationId);
        } else {
            try {
                var connFactory = com.sap.adt.communication.http.systemconnection.HttpSystemConnectionFactory.getInstance();
                var httpConn = connFactory.getOrCreateHttpSystemConnection(destinationId);
                var session = httpConn.getOrCreateEnqueueSystemSession();
                resource = factory.createRestResource(uri, session);
            } catch (Exception e) {
                Activator.log("Enqueue session failed, falling back to stateless: " + e.getMessage());
                resource = factory.createResourceWithStatelessSession(uri, destinationId);
            }
        }

        // Set up response capture
        final int[] capturedStatus = { 200 };
        final Map<String, String> capturedHeaders = new HashMap<>();
        final String[] capturedBody = { "" };

        resource.addResponseFilter(new IRestResourceResponseFilter() {
            @Override
            public void filterResponse(IRestRequestContext reqCtx, IRestResponseContext respCtx) {
                capturedStatus[0] = respCtx.getStatus();

                IHeaders hdrs = respCtx.getHeaders();
                if (hdrs != null) {
                    List<IHeaders.IField> fields = hdrs.getAllFields();
                    if (fields != null) {
                        for (IHeaders.IField field : fields) {
                            capturedHeaders.put(field.getName().toLowerCase(), field.getValue());
                        }
                    }
                }

                IMessageBody msgBody = respCtx.getBody();
                if (msgBody != null) {
                    try (InputStream is = msgBody.getContent()) {
                        if (is != null) {
                            capturedBody[0] = new String(is.readAllBytes(), StandardCharsets.UTF_8);
                        }
                    } catch (IOException e) {
                        Activator.logError("Failed to read response body", e);
                    }
                }
            }
        });

        NullProgressMonitor monitor = new NullProgressMonitor();

        try {
            IHeaders reqHeaders = buildHeaders(requestHeaders);
            String contentType = requestHeaders != null ?
                requestHeaders.getOrDefault("Content-Type",
                    requestHeaders.getOrDefault("content-type", "application/xml"))
                : "application/xml";

            switch (method) {
                case "GET":
                    resource.get(monitor, reqHeaders, Void.class);
                    break;
                case "POST":
                    resource.post(monitor, reqHeaders, Void.class, createBody(body, contentType));
                    break;
                case "PUT":
                    resource.put(monitor, reqHeaders, Void.class, createBody(body, contentType));
                    break;
                case "DELETE":
                    resource.delete(monitor, reqHeaders);
                    break;
                default:
                    throw new Exception("Unsupported method: " + method);
            }
        } catch (ResourceException e) {
            capturedStatus[0] = e.getStatus();
            if (capturedBody[0].isEmpty()) {
                capturedBody[0] = e.getMessage();
            }
        } catch (Exception e) {
            if (!capturedBody[0].isEmpty() || !capturedHeaders.isEmpty()) {
                Activator.log("Ignoring deserialization error: " + e.getMessage());
            } else {
                throw e;
            }
        }

        return new ProxyResponse(capturedStatus[0], capturedHeaders, capturedBody[0]);
    }

    private IHeaders buildHeaders(Map<String, String> headersMap) {
        if (headersMap == null || headersMap.isEmpty()) {
            return null;
        }

        IHeaders headers = HeadersFactory.newHeaders();
        for (Map.Entry<String, String> entry : headersMap.entrySet()) {
            IHeaders.IField field = HeadersFactory.newField(entry.getKey(), entry.getValue());
            headers.addField(field);
        }
        return headers;
    }

    private IMessageBody createBody(String body, String contentType) {
        if (body == null || body.isEmpty()) {
            return new ByteArrayMessageBody(contentType, new byte[0]);
        }
        return new ByteArrayMessageBody(contentType, body.getBytes(StandardCharsets.UTF_8));
    }
}
