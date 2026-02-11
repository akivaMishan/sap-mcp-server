#!/bin/bash
# Build p2 update site repository from pre-built plugin JAR.
# Requires ECLIPSE_HOME pointing to an Eclipse SDK installation.
#
# Usage:
#   ECLIPSE_HOME=/path/to/eclipse bash build-p2.sh
#
# Output: build/p2-repository/ containing a complete p2 update site
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PLUGIN_ID="io.github.akivamishan.adtbridge"
FEATURE_ID="io.github.akivamishan.adtbridge.feature"
VERSION="1.0.0"

PLUGIN_JAR="build/release/${PLUGIN_ID}_${VERSION}.jar"
FEATURE_DIR="feature"
STAGING_DIR="build/p2-staging"
OUTPUT_DIR="build/p2-repository"

# ── Validate inputs ──────────────────────────────────────────────

if [ ! -f "$PLUGIN_JAR" ]; then
    echo "ERROR: Pre-built plugin JAR not found: $PLUGIN_JAR"
    echo ""
    echo "Build the plugin first with: bash build.sh"
    echo "Then copy the JAR to build/release/:"
    echo "  mkdir -p build/release"
    echo "  cp build/${PLUGIN_ID}_${VERSION}.jar build/release/"
    exit 1
fi

if [ -z "$ECLIPSE_HOME" ]; then
    # Try common locations
    for candidate in \
        /mnt/c/Users/*/eclipse/java-*/eclipse \
        /opt/eclipse \
        "$HOME/eclipse" \
        /snap/eclipse/current; do
        if [ -d "$candidate" ] && [ -f "$candidate/eclipse" -o -f "$candidate/eclipse.exe" -o -f "$candidate/eclipsec.exe" ]; then
            ECLIPSE_HOME="$candidate"
            break
        fi
    done
fi

if [ -z "$ECLIPSE_HOME" ]; then
    echo "ERROR: ECLIPSE_HOME not set and could not auto-detect Eclipse installation."
    echo "Set it to your Eclipse SDK directory, e.g.:"
    echo "  ECLIPSE_HOME=/mnt/c/Users/you/eclipse/java-2025-12/eclipse bash build-p2.sh"
    exit 1
fi

# Find the Eclipse launcher JAR
LAUNCHER_JAR=$(ls "$ECLIPSE_HOME"/plugins/org.eclipse.equinox.launcher_*.jar 2>/dev/null | head -1)
if [ -z "$LAUNCHER_JAR" ]; then
    echo "ERROR: Could not find org.eclipse.equinox.launcher_*.jar in $ECLIPSE_HOME/plugins/"
    exit 1
fi

echo "Plugin JAR: $PLUGIN_JAR"
echo "Eclipse:    $ECLIPSE_HOME"
echo "Launcher:   $(basename "$LAUNCHER_JAR")"
echo ""

# ── Clean and set up staging ─────────────────────────────────────

rm -rf "$STAGING_DIR" "$OUTPUT_DIR"
mkdir -p "$STAGING_DIR/plugins"
mkdir -p "$STAGING_DIR/features"
mkdir -p "$OUTPUT_DIR"

# ── Copy plugin JAR ──────────────────────────────────────────────

cp "$PLUGIN_JAR" "$STAGING_DIR/plugins/"
echo "Staged plugin: plugins/${PLUGIN_ID}_${VERSION}.jar"

# ── Build feature JAR ────────────────────────────────────────────

echo "Building feature JAR..."
FEATURE_JAR_NAME="${FEATURE_ID}_${VERSION}.jar"
FEATURE_BUILD_DIR="$STAGING_DIR/feature-build"
mkdir -p "$FEATURE_BUILD_DIR"
cp "$FEATURE_DIR/feature.xml" "$FEATURE_BUILD_DIR/"

cd "$FEATURE_BUILD_DIR"
if command -v jar &>/dev/null; then
    jar cf "../features/$FEATURE_JAR_NAME" feature.xml
elif command -v zip &>/dev/null; then
    zip -0 "../features/$FEATURE_JAR_NAME" feature.xml
else
    echo "ERROR: No jar or zip command available to create feature JAR"
    exit 1
fi
cd "$SCRIPT_DIR"
rm -rf "$FEATURE_BUILD_DIR"

echo "Staged feature: features/$FEATURE_JAR_NAME"

# ── Run p2 publisher ─────────────────────────────────────────────

echo ""
echo "Running FeaturesAndBundlesPublisher..."

# Convert paths for the publisher
STAGING_ABS="$(cd "$STAGING_DIR" && pwd)"
OUTPUT_ABS="$(cd "$OUTPUT_DIR" && pwd)"

# On WSL, we may need Windows paths for the Eclipse launcher
if grep -qi microsoft /proc/version 2>/dev/null; then
    # Running in WSL — use Windows paths if Eclipse is on Windows side
    if [[ "$LAUNCHER_JAR" == /mnt/* ]]; then
        WIN_LAUNCHER=$(wslpath -w "$LAUNCHER_JAR")
        WIN_STAGING=$(wslpath -w "$STAGING_ABS")
        WIN_OUTPUT=$(wslpath -w "$OUTPUT_ABS")

        # Find java — prefer WSL java, fall back to Windows
        JAVA_CMD="java"
        if ! command -v java &>/dev/null; then
            JAVA_CMD=$(ls /mnt/c/Program\ Files/Eclipse\ Adoptium/jdk-2*/bin/java.exe 2>/dev/null | head -1)
            if [ -z "$JAVA_CMD" ]; then
                echo "ERROR: No java found. Install JDK 21+ in WSL (sudo apt install openjdk-21-jdk)"
                exit 1
            fi
        fi

        "$JAVA_CMD" -jar "$LAUNCHER_JAR" \
            -application org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher \
            -metadataRepository "file:$WIN_OUTPUT" \
            -artifactRepository "file:$WIN_OUTPUT" \
            -source "$WIN_STAGING" \
            -configs gtk.linux.x86_64 \
            -publishArtifacts \
            -compress
    else
        java -jar "$LAUNCHER_JAR" \
            -application org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher \
            -metadataRepository "file:$OUTPUT_ABS" \
            -artifactRepository "file:$OUTPUT_ABS" \
            -source "$STAGING_ABS" \
            -configs gtk.linux.x86_64 \
            -publishArtifacts \
            -compress
    fi
else
    java -jar "$LAUNCHER_JAR" \
        -application org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher \
        -metadataRepository "file:$OUTPUT_ABS" \
        -artifactRepository "file:$OUTPUT_ABS" \
        -source "$STAGING_ABS" \
        -configs gtk.linux.x86_64 \
        -publishArtifacts \
        -compress
fi

# ── Clean up staging ─────────────────────────────────────────────

rm -rf "$STAGING_DIR"

# ── Verify output ────────────────────────────────────────────────

echo ""
echo "=== P2 REPOSITORY BUILT ==="
echo "Location: $OUTPUT_DIR/"
echo ""
echo "Contents:"
ls -la "$OUTPUT_DIR/"
echo ""
echo "To test locally in Eclipse:"
echo "  Help > Install New Software > Add > Local..."
echo "  Browse to: $(pwd)/$OUTPUT_DIR"
echo ""
echo "Update site URL (after GitHub Pages deploy):"
echo "  https://akivamishan.github.io/sap-mcp-server/"
