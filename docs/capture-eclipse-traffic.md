# How to Capture Eclipse ADT HTTP Traffic

## Option 1: Enable ADT Tracing in Eclipse (Easiest)

1. In Eclipse, go to **Window → Preferences**
2. Navigate to **ABAP Development → Internal Settings** (if available)
3. Or try: **General → Tracing**
4. Enable HTTP/communication tracing

If that option doesn't exist, try adding to `eclipse.ini`:
```
-Dorg.eclipse.ecf.provider.filetransfer.httpclient.browse.connectTimeout=30000
-Djavax.net.debug=all
```

## Option 2: Use Fiddler (Best for HTTPS)

1. Download Fiddler Classic: https://www.telerik.com/download/fiddler
2. Install and run Fiddler
3. Enable HTTPS decryption:
   - Tools → Options → HTTPS
   - Check "Decrypt HTTPS traffic"
   - Install the root certificate when prompted
4. Restart Eclipse
5. Perform your actions (create class, edit class)
6. In Fiddler, filter by: `host:abap.us10.hana.ondemand.com`

## Option 3: Add Logging to Our Plugin

We can modify our plugin to log all ADT communication.
