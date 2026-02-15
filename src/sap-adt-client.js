const axios = require('axios');
const path = require('path');
const { parseStringPromise } = require('xml2js');

class SapAdtClient {
    constructor() {
        this.loadConfig();
        this.eclipseBridgePort = 19456;
        this.eclipseBridgeUrl = null; // resolved during detection
        this.useEclipseBridge = null; // null = not checked yet
    }

    loadConfig() {
        // Load environment variables
        require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
    }

    // --- Eclipse Bridge Methods ---

    async ensureBridgeChecked() {
        if (this.useEclipseBridge !== null) {
            return this.useEclipseBridge;
        }

        // If BRIDGE_URL is set, use it directly (skip auto-detection)
        if (process.env.BRIDGE_URL) {
            const url = process.env.BRIDGE_URL.replace(/\/+$/, '');
            try {
                const resp = await axios.get(`${url}/health`, { timeout: 2000 });
                if (resp.data?.status === 'ok') {
                    this.eclipseBridgeUrl = url;
                    this.useEclipseBridge = true;
                    console.error(`[MCP] Eclipse ADT bridge detected at ${url} (from BRIDGE_URL)`);
                    return true;
                }
            } catch { /* fall through to auto-detection */ }
        }

        // Try multiple hosts: localhost first, then WSL gateway (for WSL2 -> Windows)
        const hostsToTry = ['localhost', '127.0.0.1'];

        // Detect WSL and add Windows host IP
        const fs = require('fs');
        try {
            const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
            const match = resolv.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
            if (match && match[1] !== '127.0.0.1') {
                // WSL2 detected - add the gateway IP
                hostsToTry.push(match[1]);
            }
        } catch { /* not WSL or can't read resolv.conf */ }

        // Also try the default gateway (another common WSL2 pattern)
        try {
            const { execSync } = require('child_process');
            const gateway = execSync("ip route | grep default | awk '{print $3}'", { encoding: 'utf8' }).trim();
            if (gateway && !hostsToTry.includes(gateway)) {
                hostsToTry.push(gateway);
            }
        } catch { /* ignore */ }

        for (const host of hostsToTry) {
            try {
                const url = `http://${host}:${this.eclipseBridgePort}`;
                const resp = await axios.get(`${url}/health`, { timeout: 2000 });
                if (resp.data?.status === 'ok') {
                    this.eclipseBridgeUrl = url;
                    this.useEclipseBridge = true;
                    console.error(`[MCP] Eclipse ADT bridge detected at ${url}`);
                    return true;
                }
            } catch { /* try next host */ }
        }

        this.useEclipseBridge = false;
        console.error('[MCP] Eclipse ADT bridge not available — bridge is required for all SAP operations');
        return false;
    }

    async bridgeRequest(method, path, body = null, headers = {}, params = {}) {
        const resp = await axios.post(`${this.eclipseBridgeUrl}/proxy`, {
            method,
            path,
            headers,
            body,
            params,
        }, { timeout: 30000 });

        const data = resp.data;
        if (data.status >= 400) {
            const error = new Error(
                `Bridge request failed: ${data.status} ${data.body || 'Unknown error'}`
            );
            error.response = { status: data.status, data: data.body, headers: data.headers };
            throw error;
        }
        return data;
    }

    async request(endpoint, accept = '*/*') {
        if (!(await this.ensureBridgeChecked())) {
            throw new Error('Eclipse ADT bridge is not available. Start Eclipse with the ADT bridge plugin.');
        }

        const result = await this.bridgeRequest('GET', endpoint, null, {
            'Accept': accept,
        });
        return result.body;
    }

    async postRequest(endpoint, body, contentType, accept = '*/*', params = {}) {
        if (!(await this.ensureBridgeChecked())) {
            throw new Error('Eclipse ADT bridge is not available. Start Eclipse with the ADT bridge plugin.');
        }

        const result = await this.bridgeRequest('POST', endpoint, body, {
            'Content-Type': contentType,
            'Accept': accept,
        }, params);
        return { data: result.body, headers: result.headers, status: result.status };
    }

    async putRequest(endpoint, body, contentType, accept = '*/*', params = {}) {
        if (!(await this.ensureBridgeChecked())) {
            throw new Error('Eclipse ADT bridge is not available. Start Eclipse with the ADT bridge plugin.');
        }

        const result = await this.bridgeRequest('PUT', endpoint, body, {
            'Content-Type': contentType,
            'Accept': accept,
        }, params);
        return { data: result.body, headers: result.headers, status: result.status };
    }

    async checkConnection() {
        try {
            const bridgeActive = await this.ensureBridgeChecked();
            if (!bridgeActive) {
                return {
                    status: 'error',
                    mode: 'eclipse-bridge',
                    message: 'Eclipse ADT bridge not available. Start Eclipse with the ADT bridge plugin.',
                };
            }

            const data = await this.request('/sap/bc/adt/discovery', 'application/atomsvc+xml');
            return {
                status: 'connected',
                mode: 'eclipse-bridge',
                message: 'Connected via Eclipse ADT bridge (full read/write access)',
                discoverySize: data.length,
            };
        } catch (error) {
            return {
                status: 'error',
                mode: 'eclipse-bridge',
                message: error.message,
            };
        }
    }

    async search(query, maxResults = 20, objectType = '') {
        let endpoint = `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(query)}&maxResults=${maxResults}`;

        if (objectType) {
            endpoint += `&objectType=${encodeURIComponent(objectType)}`;
        }

        const xml = await this.request(endpoint, 'application/xml');
        const parsed = await parseStringPromise(xml, { explicitArray: false });

        const refs = parsed['adtcore:objectReferences']?.['adtcore:objectReference'];
        if (!refs) {
            return { results: [], count: 0 };
        }

        const results = (Array.isArray(refs) ? refs : [refs]).map(ref => ({
            name: ref.$['adtcore:name'],
            type: ref.$['adtcore:type'],
            uri: ref.$['adtcore:uri'],
            description: ref.$['adtcore:description'] || '',
            packageName: ref.$['adtcore:packageName'] || '',
        }));

        return {
            results,
            count: results.length,
            query,
        };
    }

    async readSource(objectType, objectName) {
        const name = objectName.toLowerCase();
        let endpoint;

        switch (objectType.toLowerCase()) {
            case 'class':
                endpoint = `/sap/bc/adt/oo/classes/${name}/source/main`;
                break;
            case 'interface':
                endpoint = `/sap/bc/adt/oo/interfaces/${name}/source/main`;
                break;
            case 'program':
            case 'report':
                endpoint = `/sap/bc/adt/programs/programs/${name}/source/main`;
                break;
            case 'function':
                endpoint = `/sap/bc/adt/functions/groups/${name}/source/main`;
                break;
            case 'table':
                // Tables don't have source code, return definition
                return this.getTableDefinition(name);
            default:
                throw new Error(`Unsupported object type: ${objectType}. Use: class, interface, program, function, table`);
        }

        try {
            const source = await this.request(endpoint, 'text/plain');
            return source;
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Object not found: ${objectType} ${objectName}`);
            }
            throw error;
        }
    }

    async getTableDefinition(tableName) {
        const endpoint = `/sap/bc/adt/ddic/tables/${tableName.toLowerCase()}`;
        const xml = await this.request(endpoint, '*/*');
        return xml;
    }

    async getPackage(packageName) {
        const name = packageName.toLowerCase();

        // Get package metadata
        const metadataXml = await this.request(`/sap/bc/adt/packages/${name}`, '*/*');
        const metadata = await parseStringPromise(metadataXml, { explicitArray: false });

        // Get package contents via search
        const contentsXml = await this.request(
            `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&maxResults=100&packageName=${packageName}`,
            'application/xml'
        );
        const contents = await parseStringPromise(contentsXml, { explicitArray: false });

        const refs = contents['adtcore:objectReferences']?.['adtcore:objectReference'];
        const objects = refs
            ? (Array.isArray(refs) ? refs : [refs]).map(ref => ({
                  name: ref.$['adtcore:name'],
                  type: ref.$['adtcore:type'],
                  uri: ref.$['adtcore:uri'],
                  description: ref.$['adtcore:description'] || '',
              }))
            : [];

        // Extract package info from metadata
        const pkg = metadata['pak:package']?.$;

        return {
            name: pkg?.['adtcore:name'] || packageName,
            description: pkg?.['adtcore:description'] || '',
            createdBy: pkg?.['adtcore:createdBy'] || '',
            createdAt: pkg?.['adtcore:createdAt'] || '',
            changedBy: pkg?.['adtcore:changedBy'] || '',
            changedAt: pkg?.['adtcore:changedAt'] || '',
            objects,
            objectCount: objects.length,
        };
    }

    async createProgram({ name, description, package: pkg, transport, sourceCode, language }) {
        // Normalize name: uppercase, ensure starts with Z or Y
        name = name.toUpperCase();
        if (!name.startsWith('Z') && !name.startsWith('Y')) {
            name = 'Z' + name;
        }

        // Local object handling
        if (!transport) {
            pkg = '$TMP';
        }
        pkg = (pkg || '$TMP').toUpperCase();
        language = (language || 'EN').toUpperCase();

        // Build XML body
        const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<program:abapProgram
    xmlns:program="http://www.sap.com/adt/programs/programs"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:language="${language}"
    adtcore:name="${name}"
    adtcore:type="PROG/P"
    program:programType="1">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</program:abapProgram>`;

        // POST to create the program
        const params = {};
        if (transport) {
            params.corrNr = transport;
        }

        await this.postRequest(
            '/sap/bc/adt/programs/programs',
            xmlBody,
            'application/vnd.sap.adt.programs.programs.v2+xml',
            'application/vnd.sap.adt.programs.programs.v2+xml',
            params
        );

        // If source code provided, write it (lock -> write -> unlock)
        if (sourceCode) {
            const programPath = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;

            // Lock the object
            const lockParams = { _action: 'LOCK', accessMode: 'MODIFY' };
            if (transport) {
                lockParams.corrNr = transport;
            }
            const lockResponse = await this.postRequest(
                `${programPath}`,
                '',
                'application/xml',
                'application/vnd.sap.as.adt.lock.result.v1+xml',
                lockParams
            );

            // Extract lock handle from response
            const lockXml = typeof lockResponse.data === 'string' ? lockResponse.data : '';
            const lockHandleMatch = lockXml.match(/<LOCK_HANDLE>(.*?)<\/LOCK_HANDLE>/);
            const lockHandle = lockHandleMatch ? lockHandleMatch[1] : '';

            try {
                // Write source code
                await this.putRequest(
                    `${programPath}/source/main`,
                    sourceCode,
                    'text/plain',
                    'text/plain',
                    lockHandle ? { lockHandle } : {}
                );
            } finally {
                // Unlock the object
                const unlockParams = { _action: 'UNLOCK' };
                if (lockHandle) {
                    unlockParams.lockHandle = lockHandle;
                }
                await this.postRequest(
                    `${programPath}`,
                    '',
                    'application/xml',
                    '*/*',
                    unlockParams
                );
            }
        }

        return {
            success: true,
            name,
            package: pkg,
            transport: transport || null,
            description,
            sourceCodeWritten: !!sourceCode,
        };
    }

    async writeClassSource(name, sourceCode, transport) {
        const classPath = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;

        const activateXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${classPath}" adtcore:name="${name.toUpperCase()}"/>
</adtcore:objectReferences>`;

        // Lock the object
        const lockParams = { _action: 'LOCK', accessMode: 'MODIFY' };
        if (transport) {
            lockParams.corrNr = transport;
        }
        const lockResponse = await this.postRequest(
            classPath,
            '',
            'application/xml',
            'application/vnd.sap.as+xml',
            lockParams
        );

        const lockXml = typeof lockResponse.data === 'string' ? lockResponse.data : '';
        const lockHandleMatch = lockXml.match(/<LOCK_HANDLE>(.*?)<\/LOCK_HANDLE>/);
        const lockHandle = lockHandleMatch ? lockHandleMatch[1] : '';

        try {
            await this.putRequest(
                `${classPath}/source/main`,
                sourceCode,
                'text/plain',
                'text/plain',
                lockHandle ? { lockHandle } : {}
            );
        } finally {
            // Unlock before activation — activation fails if the object is still locked
            const unlockParams = { _action: 'UNLOCK' };
            if (lockHandle) {
                unlockParams.lockHandle = lockHandle;
            }
            await this.postRequest(
                classPath,
                '',
                'application/xml',
                '*/*',
                unlockParams
            );
        }

        // Activate after unlocking
        await this.postRequest(
            '/sap/bc/adt/activation',
            activateXml,
            'application/xml',
            'application/xml',
            { method: 'activate', preauditRequested: 'true' }
        );
    }

    async createClass({ name, description, package: pkg, transport, sourceCode, language,
                         isFinal = true, visibility = 'public' }) {
        // Normalize name: uppercase, ensure starts with Z or Y
        name = name.toUpperCase();
        if (!name.startsWith('Z') && !name.startsWith('Y')) {
            name = 'Z' + name;
        }

        pkg = (pkg || 'Z_AI_TRIAL').toUpperCase();
        language = (language || 'EN').toUpperCase();
        description = description || 'Created by MCP';

        // Try to create the class first. If it already exists, fall back to update.
        // We avoid a GET existence check because the bridge's enqueue session
        // (needed for LOCK/PUT) auto-locks objects on any access.
        let action = 'created';
        try {
            const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
    xmlns:class="http://www.sap.com/adt/oo/classes"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:language="${language}"
    adtcore:name="${name}"
    adtcore:type="CLAS/OC"
    adtcore:abapLanguageVersion="cloudDevelopment"
    class:final="${isFinal}"
    class:visibility="${visibility}">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</class:abapClass>`;

            const params = {};
            if (transport) {
                params.corrNr = transport;
            }

            await this.postRequest(
                '/sap/bc/adt/oo/classes',
                xmlBody,
                'application/vnd.sap.adt.oo.classes.v4+xml',
                'application/vnd.sap.adt.oo.classes.v4+xml',
                params
            );

            // Activate the newly created class
            const activateXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/${name.toLowerCase()}" adtcore:name="${name}"/>
</adtcore:objectReferences>`;

            await this.postRequest(
                '/sap/bc/adt/activation',
                activateXml,
                'application/xml',
                'application/xml',
                { method: 'activate', preauditRequested: 'true' }
            );
        } catch (error) {
            // SAP returns 400 ExceptionResourceAlreadyExists for duplicates.
            // Switch to the update path if the class already exists.
            const isAlreadyExists = error.response?.status === 400 &&
                error.response?.data?.includes('AlreadyExists');
            if (isAlreadyExists) {
                action = 'updated';
            } else {
                throw error;
            }
        }

        // Write source code if provided
        if (sourceCode) {
            await this.writeClassSource(name, sourceCode, transport);
        }

        return {
            success: true,
            action,
            name,
            package: pkg,
            transport: transport || null,
            description,
            sourceCodeWritten: !!sourceCode,
        };
    }

    async createFunctionGroup({ name, description, package: pkg, transport, language }) {
        // Normalize name: uppercase, ensure starts with Z or Y
        name = name.toUpperCase();
        if (!name.startsWith('Z') && !name.startsWith('Y')) {
            name = 'Z' + name;
        }

        // SAP limit for function group names is 26 characters
        if (name.length > 26) {
            throw new Error(`Function group name "${name}" exceeds 26 character limit (${name.length} chars)`);
        }

        pkg = (pkg || 'Z_AI_TRIAL').toUpperCase();
        description = description || 'Created by MCP';

        let action = 'created';
        try {
            const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup
    xmlns:group="http://www.sap.com/adt/functions/groups"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${name}"
    adtcore:type="FUGR/F"
    adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</group:abapFunctionGroup>`;

            const params = {};
            if (transport) {
                params.corrNr = transport;
            }

            await this.postRequest(
                '/sap/bc/adt/functions/groups',
                xmlBody,
                'application/*',
                'application/*',
                params
            );

            // Activate the newly created function group
            const fgPath = `/sap/bc/adt/functions/groups/${name.toLowerCase()}`;
            const activateXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${fgPath}" adtcore:name="${name}"/>
</adtcore:objectReferences>`;

            await this.postRequest(
                '/sap/bc/adt/activation',
                activateXml,
                'application/xml',
                'application/xml',
                { method: 'activate', preauditRequested: 'true' }
            );
        } catch (error) {
            const isAlreadyExists = error.response?.status === 400 &&
                error.response?.data?.includes('AlreadyExists');
            if (isAlreadyExists) {
                action = 'already_existed';
            } else {
                throw error;
            }
        }

        return {
            success: true,
            action,
            name,
            package: pkg,
            transport: transport || null,
            description,
        };
    }

    async writeFunctionModuleSource(fgName, fmName, sourceCode, transport) {
        const fmPath = `/sap/bc/adt/functions/groups/${fgName.toLowerCase()}/fmodules/${fmName.toLowerCase()}`;

        // Lock the function module
        const lockParams = { _action: 'LOCK', accessMode: 'MODIFY' };
        if (transport) {
            lockParams.corrNr = transport;
        }
        const lockResponse = await this.postRequest(
            fmPath,
            '',
            'application/xml',
            'application/vnd.sap.as.adt.lock.result.v1+xml',
            lockParams
        );

        const lockXml = typeof lockResponse.data === 'string' ? lockResponse.data : '';
        const lockHandleMatch = lockXml.match(/<LOCK_HANDLE>(.*?)<\/LOCK_HANDLE>/);
        const lockHandle = lockHandleMatch ? lockHandleMatch[1] : '';

        try {
            await this.putRequest(
                `${fmPath}/source/main`,
                sourceCode,
                'text/plain',
                'text/plain',
                lockHandle ? { lockHandle } : {}
            );
        } finally {
            // Unlock before activation
            const unlockParams = { _action: 'UNLOCK' };
            if (lockHandle) {
                unlockParams.lockHandle = lockHandle;
            }
            await this.postRequest(
                fmPath,
                '',
                'application/xml',
                '*/*',
                unlockParams
            );
        }

        // Activate after unlocking
        const activateXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${fmPath}" adtcore:name="${fmName.toUpperCase()}"/>
</adtcore:objectReferences>`;

        await this.postRequest(
            '/sap/bc/adt/activation',
            activateXml,
            'application/xml',
            'application/xml',
            { method: 'activate', preauditRequested: 'true' }
        );
    }

    async createFunctionModule({ name, description, functionGroup, package: pkg, transport, sourceCode, language }) {
        // Normalize FM name: uppercase, ensure starts with Z_ or Y_
        name = name.toUpperCase();
        if (!name.startsWith('Z') && !name.startsWith('Y')) {
            name = 'Z_' + name;
        }

        pkg = (pkg || 'Z_AI_TRIAL').toUpperCase();
        description = description || 'Created by MCP';

        // Resolve function group
        let fgName;
        if (functionGroup) {
            fgName = functionGroup.toUpperCase();
            if (!fgName.startsWith('Z') && !fgName.startsWith('Y')) {
                fgName = 'Z' + fgName;
            }
        } else {
            // Use FM name as FG name, truncated to 26 chars
            fgName = name.length > 26 ? name.substring(0, 26) : name;
        }

        // Ensure the function group exists (createFunctionGroup handles "already exists" gracefully)
        await this.createFunctionGroup({
            name: fgName,
            description: `Function group for ${name}`,
            package: pkg,
            transport,
            language,
        });

        let action = 'created';
        try {
            const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<fmodule:abapFunctionModule
    xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${name}"
    adtcore:type="FUGR/FF">
  <adtcore:containerRef
      adtcore:name="${fgName}"
      adtcore:type="FUGR/F"
      adtcore:uri="/sap/bc/adt/functions/groups/${fgName.toLowerCase()}"/>
</fmodule:abapFunctionModule>`;

            const params = {};
            if (transport) {
                params.corrNr = transport;
            }

            await this.postRequest(
                `/sap/bc/adt/functions/groups/${fgName.toLowerCase()}/fmodules`,
                xmlBody,
                'application/*',
                'application/*',
                params
            );

            // Activate the newly created function module
            const fmPath = `/sap/bc/adt/functions/groups/${fgName.toLowerCase()}/fmodules/${name.toLowerCase()}`;
            const activateXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${fmPath}" adtcore:name="${name}"/>
</adtcore:objectReferences>`;

            await this.postRequest(
                '/sap/bc/adt/activation',
                activateXml,
                'application/xml',
                'application/xml',
                { method: 'activate', preauditRequested: 'true' }
            );
        } catch (error) {
            const isAlreadyExists = error.response?.status === 400 &&
                error.response?.data?.includes('AlreadyExists');
            if (isAlreadyExists) {
                action = 'updated';
            } else {
                throw error;
            }
        }

        // Write source code if provided
        if (sourceCode) {
            await this.writeFunctionModuleSource(fgName, name, sourceCode, transport);
        }

        return {
            success: true,
            action,
            name,
            functionGroup: fgName,
            package: pkg,
            transport: transport || null,
            description,
            sourceCodeWritten: !!sourceCode,
        };
    }

    async getObjectInfo(uri) {
        if (!uri.startsWith('/')) {
            uri = '/' + uri;
        }

        const xml = await this.request(uri, '*/*');
        const parsed = await parseStringPromise(xml, { explicitArray: false });
        return parsed;
    }
}

module.exports = SapAdtClient;
