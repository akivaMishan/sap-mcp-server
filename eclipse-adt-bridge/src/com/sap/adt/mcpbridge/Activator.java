package com.sap.adt.mcpbridge;

import org.eclipse.core.runtime.ILog;
import org.eclipse.core.runtime.Platform;
import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;

public class Activator implements BundleActivator {

    public static final String PLUGIN_ID = "com.sap.adt.mcpbridge";

    private static Activator instance;
    private static ILog logger;
    private BridgeHttpServer server;

    @Override
    public void start(BundleContext context) throws Exception {
        instance = this;
        logger = Platform.getLog(Activator.class);
        log("MCP Bridge plugin starting...");

        server = new BridgeHttpServer(19456);
        server.start();

        log("MCP Bridge plugin started on port 19456");
    }

    @Override
    public void stop(BundleContext context) throws Exception {
        log("MCP Bridge plugin stopping...");
        if (server != null) {
            server.stop();
        }
        instance = null;
    }

    public static Activator getInstance() {
        return instance;
    }

    public static void log(String message) {
        if (logger != null) {
            logger.info(message);
        }
        System.out.println("[MCP Bridge] " + message);
    }

    public static void logError(String message, Throwable t) {
        if (logger != null) {
            logger.error(message, t);
        }
        System.err.println("[MCP Bridge] ERROR: " + message);
        if (t != null) {
            t.printStackTrace(System.err);
        }
    }
}
