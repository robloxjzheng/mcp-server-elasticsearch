#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Client, estypes, ClientOptions } from "@elastic/elasticsearch";
import fs from "fs";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  console.log(args);
  const parsed: Record<string, string> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++; // Skip the value in the next iteration
      } else {
        parsed[key] = "true";
      }
    }
  }
  
  return parsed;
}

const cliArgs = parseArgs();

// Configuration schema with auth options
const ConfigSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "Elasticsearch URL cannot be empty")
      .url("Invalid Elasticsearch URL format")
      .describe("Elasticsearch server URL"),

    apiKey: z
      .string()
      .optional()
      .describe("API key for Elasticsearch authentication"),

    username: z
      .string()
      .optional()
      .describe("Username for Elasticsearch authentication"),

    password: z
      .string()
      .optional()
      .describe("Password for Elasticsearch authentication"),

    caCert: z
      .string()
      .optional()
      .describe("Path to custom CA certificate for Elasticsearch"),
  })
  .refine(
    (data) => {
      // If username is provided, password must be provided
      if (data.username) {
        return !!data.password;
      }

      // If password is provided, username must be provided
      if (data.password) {
        return !!data.username;
      }

      // If apiKey is provided, it's valid
      if (data.apiKey) {
        return true;
      }

      // No auth is also valid (for local development)
      return true;
    },
    {
      message:
        "Either ES_API_KEY or both ES_USERNAME and ES_PASSWORD must be provided, or no auth for local development",
      path: ["username", "password"],
    }
  );

type ElasticsearchConfig = z.infer<typeof ConfigSchema>;

export async function createElasticsearchMcpServer(
  config: ElasticsearchConfig
): Promise<McpServer> {
  const validatedConfig = ConfigSchema.parse(config);
  const { url, apiKey, username, password, caCert } = validatedConfig;

  const clientOptions: ClientOptions = {
    node: url,
  };

  // Set up authentication
  if (apiKey) {
    clientOptions.auth = { apiKey };
  } else if (username && password) {
    clientOptions.auth = { username, password };
  }

  // Set up SSL/TLS certificate if provided
  if (caCert) {
    try {
      const ca = fs.readFileSync(caCert);
      clientOptions.tls = { ca };
    } catch (error) {
      console.error(
        `Failed to read certificate file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const esClient = new Client(clientOptions);

  const server = new McpServer({
    name: "elasticsearch-mcp-server",
    version: "0.1.1",
  });

  // // Tool 1: List indices
  // server.tool(
  //   "list_indices",
  //   "List all available Elasticsearch indices",
  //   {},
  //   async () => {
  //     try {
  //       const response = await esClient.cat.indices({ format: "json" });

  //       const indicesInfo = response.map((index) => ({
  //         index: index.index,
  //         health: index.health,
  //         status: index.status,
  //         docsCount: index.docsCount,
  //       }));

  //       return {
  //         content: [
  //           {
  //             type: "text" as const,
  //             text: `Found ${indicesInfo.length} indices`,
  //           },
  //           {
  //             type: "text" as const,
  //             text: JSON.stringify(indicesInfo, null, 2),
  //           },
  //         ],
  //       };
  //     } catch (error) {
  //       console.error(
  //         `Failed to list indices: ${
  //           error instanceof Error ? error.message : String(error)
  //         }`
  //       );
  //       return {
  //         content: [
  //           {
  //             type: "text" as const,
  //             text: `Error: ${
  //               error instanceof Error ? error.message : String(error)
  //             }`,
  //           },
  //         ],
  //       };
  //     }
  //   }
  // );

  // Tool 2: Get mappings for an index
  server.tool(
    "get_service_log_mappings",
    "Get field mappings for all service log Elasticsearch indices",
    {},
    async ({}) => {
      try {
        const mappingResponse = await esClient.indices.getMapping({
          index: "bedev2",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Mappings for service log indices`,
            },
            {
              type: "text" as const,
              text: `Mappings for service logs: ${JSON.stringify(
                mappingResponse["bedev2"]?.mappings || {},
                null,
                2
              )}`,
            },
          ],
        };
      } catch (error) {
        console.error(
          `Failed to get mappings: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // // Tool 3: Search an index with simplified parameters
  // server.tool(
  //   "search",
  //   "Perform an Elasticsearch search with the provided query DSL. Highlights are always enabled.",
  //   {
  //     index: z
  //       .string()
  //       .trim()
  //       .min(1, "Index name is required")
  //       .describe("Name of the Elasticsearch index to search"),

  //     queryBody: z
  //       .record(z.any())
  //       .refine(
  //         (val) => {
  //           try {
  //             JSON.parse(JSON.stringify(val));
  //             return true;
  //           } catch (e) {
  //             return false;
  //           }
  //         },
  //         {
  //           message: "queryBody must be a valid Elasticsearch query DSL object",
  //         }
  //       )
  //       .describe(
  //         "Complete Elasticsearch query DSL object that can include query, size, from, sort, etc."
  //       ),
  //   },
  //   async ({ index, queryBody }) => {
  //     try {
  //       // Get mappings to identify text fields for highlighting
  //       const mappingResponse = await esClient.indices.getMapping({
  //         index,
  //       });

  //       const indexMappings = mappingResponse[index]?.mappings || {};

  //       const searchRequest: estypes.SearchRequest = {
  //         index,
  //         ...queryBody,
  //       };

  //       // Always do highlighting
  //       if (indexMappings.properties) {
  //         const textFields: Record<string, estypes.SearchHighlightField> = {};

  //         for (const [fieldName, fieldData] of Object.entries(
  //           indexMappings.properties
  //         )) {
  //           if (fieldData.type === "text" || "dense_vector" in fieldData) {
  //             textFields[fieldName] = {};
  //           }
  //         }

  //         searchRequest.highlight = {
  //           fields: textFields,
  //           pre_tags: ["<em>"],
  //           post_tags: ["</em>"],
  //         };
  //       }

  //       const result = await esClient.search(searchRequest);

  //       // Extract the 'from' parameter from queryBody, defaulting to 0 if not provided
  //       const from = queryBody.from || 0;

  //       const contentFragments = result.hits.hits.map((hit) => {
  //         const highlightedFields = hit.highlight || {};
  //         const sourceData = hit._source || {};

  //         let content = "";

  //         for (const [field, highlights] of Object.entries(highlightedFields)) {
  //           if (highlights && highlights.length > 0) {
  //             content += `${field} (highlighted): ${highlights.join(
  //               " ... "
  //             )}\n`;
  //           }
  //         }

  //         for (const [field, value] of Object.entries(sourceData)) {
  //           if (!(field in highlightedFields)) {
  //             content += `${field}: ${JSON.stringify(value)}\n`;
  //           }
  //         }

  //         return {
  //           type: "text" as const,
  //           text: content.trim(),
  //         };
  //       });

  //       const metadataFragment = {
  //         type: "text" as const,
  //         text: `Total results: ${
  //           typeof result.hits.total === "number"
  //             ? result.hits.total
  //             : result.hits.total?.value || 0
  //         }, showing ${result.hits.hits.length} from position ${from}`,
  //       };

  //       return {
  //         content: [metadataFragment, ...contentFragments],
  //       };
  //     } catch (error) {
  //       console.error(
  //         `Search failed: ${
  //           error instanceof Error ? error.message : String(error)
  //         }`
  //       );
  //       return {
  //         content: [
  //           {
  //             type: "text" as const,
  //             text: `Error: ${
  //               error instanceof Error ? error.message : String(error)
  //             }`,
  //           },
  //         ],
  //       };
  //     }
  //   }
  // );

  // // Tool 4: Get shard information
  // server.tool(
  //   "get_shards",
  //   "Get shard information for all or specific indices",
  //   {
  //     index: z
  //       .string()
  //       .optional()
  //       .describe("Optional index name to get shard information for"),
  //   },
  //   async ({ index }) => {
  //     try {
  //       const response = await esClient.cat.shards({
  //         index,
  //         format: "json",
  //       });

  //       const shardsInfo = response.map((shard) => ({
  //         index: shard.index,
  //         shard: shard.shard,
  //         prirep: shard.prirep,
  //         state: shard.state,
  //         docs: shard.docs,
  //         store: shard.store,
  //         ip: shard.ip,
  //         node: shard.node,
  //       }));

  //       const metadataFragment = {
  //         type: "text" as const,
  //         text: `Found ${shardsInfo.length} shards${
  //           index ? ` for index ${index}` : ""
  //         }`,
  //       };

  //       return {
  //         content: [
  //           metadataFragment,
  //           {
  //             type: "text" as const,
  //             text: JSON.stringify(shardsInfo, null, 2),
  //           },
  //         ],
  //       };
  //     } catch (error) {
  //       console.error(
  //         `Failed to get shard information: ${
  //           error instanceof Error ? error.message : String(error)
  //         }`
  //       );
  //       return {
  //         content: [
  //           {
  //             type: "text" as const,
  //             text: `Error: ${
  //               error instanceof Error ? error.message : String(error)
  //             }`,
  //           },
  //         ],
  //       };
  //     }
  //   }
  // );

  // Tool to get aggregations for service logs from 'bedev2'
  server.tool(
    "aggregate_service_logs",
    "Perform Elasticsearch search API aggregations for service logs",
    {
      service_name: z
        .string()
        .trim()
        .min(1, "Service name is required")
        .describe("Service name to aggregate logs for (nomad_task_name)"),
      start_minutes_ago: z
        .number()
        .min(0)
        .optional()
        .describe(
          "Optional: Start of the time window in minutes ago. If not provided, aggregates over all time."
        ),
      duration_minutes: z
        .number()
        .min(1)
        .optional()
        .default(30)
        .describe(
          "Optional: Duration of the time window in minutes (default: 30). Used with `start_minutes_ago`."
        ),
      aggs: z
        .record(z.any())
        .refine(
          (val) => {
            try {
              JSON.parse(JSON.stringify(val));
              return true;
            } catch (e) {
              return false;
            }
          },
          {
            message: "queryBody must be a valid Elasticsearch aggs object",
          }
        )
        .describe(
          "Complete Elasticsearch search API aggs object"
        ),
    },
    async ({
      service_name,
      aggs,
      start_minutes_ago,
      duration_minutes,
    }) => {
      try {
        let time_range_text = "all time";
        const filters: any[] = [
          {
            term: {
              "nomad_task_name.keyword": service_name,
            },
          },
        ];

        if (start_minutes_ago !== undefined) {
          const now = Date.now();
          const startTimeMs = now - start_minutes_ago * 60 * 1000;
          const endTimeMs = startTimeMs + duration_minutes * 60 * 1000;

          filters.push({
            range: {
              "@timestamp": {
                gte: new Date(startTimeMs).toISOString(),
                lte: new Date(endTimeMs).toISOString(),
              },
            },
          });
          time_range_text = `from ${start_minutes_ago} minutes ago for ${duration_minutes} minutes`;
        }

        const searchRequest: estypes.SearchRequest = {
          index: "bedev2",
          size: 0, // We only want aggregations, not hits
          query: {
            bool: {
              filter: filters,
            },
          },
          aggs: aggs,
        };

        const result = await esClient.search(searchRequest);

        const totalHits =
          typeof result.hits.total === "number"
            ? result.hits.total
            : result.hits.total?.value ?? 0;

        const summary = {
          service_name,
          time_range: time_range_text,
          total_logs: totalHits,
          aggregations: result.aggregations || {},
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Aggregation results for service '${service_name}' over ${time_range_text}:`,
            },
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(
          `Failed to get aggregations for ${service_name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting aggregations for ${service_name}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool to fetch recent logs from 'bedev2'
  server.tool(
    "get_service_logs",
    "Fetch entire service logs from the bedev2 alias, to be used for summarizing and describing logs",
    {
      service_name: z
        .string()
        .trim()
        .min(1, "Service name is required")
        .describe("Service name to filter logs by (nomad_task_name)"),
      log_level: z
        .string()
        .optional()
        .describe("Optional log level to filter by (log.level_normalized)"),
      count: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .default(10)
        .describe("Optional number of logs to fetch (default: 100)"),
      start_minutes_ago: z
        .number()
        .min(0)
        .optional()
        .describe(
          "Optional: Start of the time window in minutes ago. Fetches recent logs if not provided."
        ),
      duration_minutes: z
        .number()
        .min(1)
        .optional()
        .default(30)
        .describe(
          "Optional: Duration of the time window in minutes (default: 30)."
        ),
    },
    async ({
      service_name,
      log_level,
      count,
      start_minutes_ago,
      duration_minutes,
    }) => {
      try {
        const filters: any[] = [
          {
            term: {
              "nomad_task_name.keyword": service_name,
            },
          },
        ];

        if (log_level) {
          filters.push({
            term: {
              "log.level_normalized": log_level,
            },
          });
        }

        if (start_minutes_ago !== undefined) {
          const now = Date.now();
          const startTimeMs = now - start_minutes_ago * 60 * 1000;
          const endTimeMs = startTimeMs + duration_minutes * 60 * 1000;

          filters.push({
            range: {
              "@timestamp": {
                gte: new Date(startTimeMs).toISOString(),
                lte: new Date(endTimeMs).toISOString(),
              },
            },
          });
        }

        const searchRequest: estypes.SearchRequest = {
          index: "bedev2",
          size: count,
          sort: [{ "@timestamp": "desc" }],
          query: {
            bool: {
              filter: filters,
            },
          },
        };

        const result = await esClient.search(searchRequest);

        const logSources = result.hits.hits.map((hit) => hit._source);

        const contentFragments = logSources.map((source) => ({
          type: "text" as const,
          text: JSON.stringify(source, null, 2),
        }));

        const totalHits =
          typeof result.hits.total === "number"
            ? result.hits.total
            : result.hits.total?.value ?? 0;

        const metadataFragment = {
          type: "text" as const,
          text: `Showing the last ${logSources.length} of ${totalHits} total logs from ${service_name}.`,
        };

        return {
          content: [metadataFragment, ...contentFragments],
        };
      } catch (error) {
        console.error(
          `Failed to fetch logs from bedev2: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching logs from bedev2: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  return server;
}

const config: ElasticsearchConfig = {
  url: process.env.ES_URL || "",
  apiKey: process.env.ES_API_KEY || "",
  username: process.env.ES_USERNAME || "",
  password: process.env.ES_PASSWORD || "",
  caCert: process.env.ES_CA_CERT || "",
};

console.log(cliArgs);
if (cliArgs.remote) {
  const app = express();

  const server = await createElasticsearchMcpServer(config);

  let transport: SSEServerTransport | null = null;

  app.get("/sse", (req: express.Request, res: express.Response) => {
    transport = new SSEServerTransport("/messages", res);
    server.connect(transport);
  });

  app.post("/messages", (req: express.Request, res: express.Response) => {
    if (transport) {
      transport.handlePostMessage(req, res);
    }
  });

  const port = cliArgs.port || process.env.MCP_SERVER_PORT || 3000;
  console.log("Starting MCP server on port", port);
  app.listen(port);
} else {
  const transport = new StdioServerTransport();
  const server = await createElasticsearchMcpServer(config);
  // console.log(server);
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}
