#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const SapAdtClient = require('./sap-adt-client');

// Create SAP ADT client
const sapClient = new SapAdtClient();

// Create MCP server
const server = new Server(
    {
        name: 'sap-adt-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'sap_search',
                description: 'Search for ABAP objects (classes, programs, packages, function modules, etc.) in the SAP system',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query (e.g., "Z*" for all custom objects, "CL_*" for classes starting with CL_)',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of results (default: 20)',
                            default: 20,
                        },
                        objectType: {
                            type: 'string',
                            description: 'Filter by object type: CLAS (class), PROG (program), FUGR (function group), DEVC (package), TABL (table), etc.',
                        },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'sap_read_source',
                description: 'Read the source code of an ABAP object (class, program, function module, etc.)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectType: {
                            type: 'string',
                            description: 'Type of object: class, program, function, interface, table',
                            enum: ['class', 'program', 'function', 'interface', 'table'],
                        },
                        objectName: {
                            type: 'string',
                            description: 'Name of the ABAP object (e.g., ZFIRST_CLASS, Z_MY_PROGRAM)',
                        },
                    },
                    required: ['objectType', 'objectName'],
                },
            },
            {
                name: 'sap_get_package',
                description: 'Get information about a package and list its contents',
                inputSchema: {
                    type: 'object',
                    properties: {
                        packageName: {
                            type: 'string',
                            description: 'Name of the package (e.g., Z_AI_TRIAL)',
                        },
                    },
                    required: ['packageName'],
                },
            },
            {
                name: 'sap_get_object_info',
                description: 'Get detailed metadata about an ABAP object',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uri: {
                            type: 'string',
                            description: 'ADT URI of the object (e.g., /sap/bc/adt/oo/classes/zfirst_class)',
                        },
                    },
                    required: ['uri'],
                },
            },
            {
                name: 'sap_check_connection',
                description: 'Check if the SAP connection is working and get system information',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'sap_create_class',
                description: 'Create or update an ABAP class. If the class already exists, updates its source code. If it doesn\'t exist, creates it. The class is automatically activated.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Class name (must start with Z or Y). If not starting with Z, it will be prefixed automatically.',
                        },
                        description: {
                            type: 'string',
                            description: 'Short description of the class',
                        },
                        package: {
                            type: 'string',
                            description: 'Package name (default: $TMP for local)',
                        },
                        transport: {
                            type: 'string',
                            description: 'Transport request number. Omit for local objects ($TMP)',
                        },
                        sourceCode: {
                            type: 'string',
                            description: 'Full ABAP source code for the class (definition + implementation). If omitted, an empty class skeleton is created.',
                        },
                        isFinal: {
                            type: 'boolean',
                            description: 'Whether the class is final (default: true)',
                        },
                        visibility: {
                            type: 'string',
                            description: 'Class visibility: public, protected, private (default: public)',
                            enum: ['public', 'protected', 'private'],
                        },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'sap_create_program',
                description: 'Create a new ABAP program (report) in the SAP system',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Program name (must start with Z or Y). If not starting with Z, it will be prefixed automatically.',
                        },
                        description: {
                            type: 'string',
                            description: 'Short description of the program',
                        },
                        package: {
                            type: 'string',
                            description: 'Package name (default: $TMP for local)',
                        },
                        transport: {
                            type: 'string',
                            description: 'Transport request number. Omit for local objects ($TMP)',
                        },
                        sourceCode: {
                            type: 'string',
                            description: 'Initial ABAP source code for the program',
                        },
                        language: {
                            type: 'string',
                            description: 'Language key (default: EN)',
                        },
                    },
                    required: ['name', 'description'],
                },
            },
        ],
    };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'sap_search': {
                const results = await sapClient.search(
                    args.query,
                    args.maxResults || 20,
                    args.objectType
                );
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(results, null, 2),
                        },
                    ],
                };
            }

            case 'sap_read_source': {
                const source = await sapClient.readSource(
                    args.objectType,
                    args.objectName
                );
                return {
                    content: [
                        {
                            type: 'text',
                            text: source,
                        },
                    ],
                };
            }

            case 'sap_get_package': {
                const pkg = await sapClient.getPackage(args.packageName);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(pkg, null, 2),
                        },
                    ],
                };
            }

            case 'sap_get_object_info': {
                const info = await sapClient.getObjectInfo(args.uri);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(info, null, 2),
                        },
                    ],
                };
            }

            case 'sap_check_connection': {
                const status = await sapClient.checkConnection();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(status, null, 2),
                        },
                    ],
                };
            }

            case 'sap_create_class': {
                const classResult = await sapClient.createClass(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(classResult, null, 2),
                        },
                    ],
                };
            }

            case 'sap_create_program': {
                const result = await sapClient.createProgram(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('SAP ADT MCP Server running on stdio');
}

main().catch(console.error);
