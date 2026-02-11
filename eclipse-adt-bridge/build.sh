#!/bin/bash
# Build script for Eclipse ADT Bridge Plugin
# Run from WSL: bash build.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Eclipse plugin pool directory
P2_POOL="/mnt/c/Users/akivo/.p2/pool/plugins"

# Output
OUTPUT_DIR="$SCRIPT_DIR/build"
JAR_NAME="io.github.akivamishan.adtbridge_1.0.1.jar"

# Detect if javac is Windows-side (.exe) — if so we need Windows paths
WINDOWS_JAVAC=false

# Convert WSL path to Windows path
wslpath_to_win() {
    wslpath -w "$1"
}

# Find javac - prefer WSL-native JDK 11+, then Windows JDK
find_javac() {
    # Check WSL-native JDK 11+
    if command -v javac &>/dev/null; then
        local ver
        ver=$(javac -version 2>&1 | grep -oP '\d+' | head -1)
        if [ "$ver" -ge 11 ] 2>/dev/null; then
            echo "javac"
            return
        fi
    fi

    # Windows-side JDK: set flag
    WINDOWS_JAVAC=true

    # Check Eclipse JustJ JDK
    local justj_dir
    justj_dir=$(ls -d "$P2_POOL"/org.eclipse.justj.openjdk.hotspot.jre.full.win32.x86_64_* 2>/dev/null | head -1)
    if [ -n "$justj_dir" ] && [ -f "$justj_dir/jre/bin/javac.exe" ]; then
        echo "$justj_dir/jre/bin/javac.exe"
        return
    fi

    # Check Adoptium JDK 11+
    local adoptium
    for adoptium in /mnt/c/Program\ Files/Eclipse\ Adoptium/jdk-*/bin/javac.exe; do
        if [ -f "$adoptium" ]; then
            echo "$adoptium"
            return
        fi
    done

    WINDOWS_JAVAC=false
    echo ""
}

JAVAC=$(find_javac)
# Detect Windows javac after the function runs (subshell doesn't propagate)
if [[ "$JAVAC" == *.exe ]]; then
    WINDOWS_JAVAC=true
fi
if [ -z "$JAVAC" ]; then
    echo "ERROR: No JDK 11+ javac found."
    echo ""
    echo "Option 1 (recommended): Install JDK 11+ in WSL:"
    echo "  sudo apt install openjdk-11-jdk"
    echo ""
    echo "Option 2: Eclipse JustJ should be at:"
    echo "  $P2_POOL/org.eclipse.justj.openjdk.hotspot.jre.full.win32.x86_64_*/jre/bin/javac.exe"
    exit 1
fi

echo "Using javac: $JAVAC"
echo "Windows javac: $WINDOWS_JAVAC"
"$JAVAC" -version 2>&1 || true

# Resolve JARs from the p2 pool
resolve_jar() {
    local pattern="$1"
    local jar
    jar=$(ls "$P2_POOL"/${pattern}*.jar 2>/dev/null | head -1)
    if [ -z "$jar" ]; then
        echo "WARNING: Could not find JAR matching: $pattern" >&2
        return 1
    fi
    echo "$jar"
}

echo ""
echo "Resolving classpath JARs..."

# Build classpath - use semicolons for Windows javac, colons for Linux
if [ "$WINDOWS_JAVAC" = true ]; then
    SEP=";"
else
    SEP=":"
fi

CP=""
add_to_cp() {
    local jar
    jar=$(resolve_jar "$1") || { echo "FATAL: Missing required JAR: $1"; exit 1; }
    local cp_jar="$jar"
    if [ "$WINDOWS_JAVAC" = true ]; then
        cp_jar=$(wslpath_to_win "$jar")
    fi
    if [ -n "$CP" ]; then
        CP="$CP$SEP"
    fi
    CP="${CP}${cp_jar}"
    echo "  + $(basename "$jar")"
}

add_to_cp "org.eclipse.core.runtime_"
add_to_cp "org.eclipse.core.resources_"
add_to_cp "org.eclipse.core.filesystem_"
add_to_cp "org.eclipse.equinox.common_"
add_to_cp "org.eclipse.osgi_"
add_to_cp "org.eclipse.ui_"
add_to_cp "com.sap.adt.communication_"
add_to_cp "com.sap.adt.project_"
add_to_cp "com.sap.adt.destinations_"
add_to_cp "com.sap.adt.destinations.model_"
add_to_cp "com.sap.adt.logging_"
add_to_cp "com.sap.adt.util_"
add_to_cp "com.google.gson_"
add_to_cp "org.eclipse.ui.workbench_"
add_to_cp "org.eclipse.core.jobs_"

# Also need Eclipse JFace for IStartup
JFACE_JAR=$(resolve_jar "org.eclipse.jface_" 2>/dev/null || echo "")
if [ -n "$JFACE_JAR" ]; then
    local_jface="$JFACE_JAR"
    if [ "$WINDOWS_JAVAC" = true ]; then
        local_jface=$(wslpath_to_win "$JFACE_JAR")
    fi
    CP="$CP$SEP$local_jface"
    echo "  + $(basename "$JFACE_JAR")"
fi

echo ""
echo "Compiling Java sources..."

# Clean and create output
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/classes"

# Find all Java source files
SOURCES=$(find src -name "*.java")
echo "Sources:"
echo "$SOURCES" | while read -r s; do echo "  $s"; done

# Build source file list and output dir for javac
if [ "$WINDOWS_JAVAC" = true ]; then
    # Windows javac needs Windows paths for sources and output dir
    WIN_OUTPUT=$(wslpath_to_win "$OUTPUT_DIR/classes")

    # Write source file list to a temp file (Windows-friendly paths)
    SRCLIST="$OUTPUT_DIR/sources.txt"
    > "$SRCLIST"
    for src in $SOURCES; do
        wslpath_to_win "$SCRIPT_DIR/$src" >> "$SRCLIST"
    done

    echo ""
    echo "Invoking Windows javac..."
    "$JAVAC" \
        -source 11 \
        -target 11 \
        -classpath "$CP" \
        -d "$WIN_OUTPUT" \
        "@$(wslpath_to_win "$SRCLIST")"
else
    "$JAVAC" \
        -source 11 \
        -target 11 \
        -classpath "$CP" \
        -d "$OUTPUT_DIR/classes" \
        $SOURCES
fi

echo "Compilation successful!"

echo ""
echo "Packaging JAR..."

# Copy metadata
mkdir -p "$OUTPUT_DIR/classes/META-INF"
cp META-INF/MANIFEST.MF "$OUTPUT_DIR/classes/META-INF/"
cp plugin.xml "$OUTPUT_DIR/classes/"

# Build JAR
cd "$OUTPUT_DIR/classes"
rm -f "../$JAR_NAME"

if command -v jar &>/dev/null; then
    jar cfm "../$JAR_NAME" META-INF/MANIFEST.MF .
elif command -v zip &>/dev/null; then
    zip -0 "../$JAR_NAME" META-INF/MANIFEST.MF
    zip -r "../$JAR_NAME" . -x META-INF/MANIFEST.MF
elif [ "$WINDOWS_JAVAC" = true ]; then
    # Use jar.exe from the same JDK as javac.exe
    JAR_EXE="$(dirname "$JAVAC")/jar.exe"
    if [ -f "$JAR_EXE" ]; then
        WIN_MANIFEST=$(wslpath -w "$OUTPUT_DIR/classes/META-INF/MANIFEST.MF")
        WIN_CLASSES=$(wslpath -w "$OUTPUT_DIR/classes")
        WIN_JAR=$(wslpath -w "$OUTPUT_DIR/$JAR_NAME")
        "$JAR_EXE" cfm "$WIN_JAR" "$WIN_MANIFEST" -C "$WIN_CLASSES" .
    else
        echo "ERROR: No jar, zip, or jar.exe found to create JAR"
        exit 1
    fi
else
    echo "ERROR: No jar or zip command available to create JAR"
    exit 1
fi

cd "$SCRIPT_DIR"

echo "Built: $OUTPUT_DIR/$JAR_NAME"

# Verify JAR contents
echo ""
echo "JAR contents:"
unzip -l "$OUTPUT_DIR/$JAR_NAME" | grep "\.class\|MANIFEST\|plugin.xml"

echo ""
echo "=== BUILD COMPLETE ==="
echo "JAR: $OUTPUT_DIR/$JAR_NAME"
echo "Install via p2 update site: https://akivamishan.github.io/sap-mcp-server/"
echo "Test with: curl http://localhost:19456/health"
