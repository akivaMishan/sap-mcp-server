package io.github.akivamishan.adtbridge;

import org.eclipse.ui.IStartup;

public class EarlyStartup implements IStartup {

    @Override
    public void earlyStartup() {
        // The bundle activator starts the HTTP server.
        // This class just ensures the bundle is activated early.
        Activator.log("EarlyStartup triggered - MCP Bridge is active");
    }
}
