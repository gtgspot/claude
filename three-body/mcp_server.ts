// Three-Body MCP Server — exposes the orchestrator as an MCP tool over stdio.
// Clients (Claude Code, Claude Desktop, any MCP host) can call three_body_reason
// to get multi-body DeepSeek reasoning on any query + optional input document.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runThreeBody } from "./orchestrator.js";
import { loadConfig } from "./config.js";
import { ThreeBodyResult } from "./schema.js";

function formatResult(result: ThreeBodyResult): string {
  const issue = result.reasoning_issues[0];
  const lines: string[] = [];

  lines.push(`# Three-Body Reasoning Result`);
  lines.push(`**Convergence:** ${result.convergence_status}  |  **Confidence:** ${result.confidence_tier}`);
  lines.push(`**Bodies activated:** ${result.metadata.bodies_activated.join(", ")}`);
  lines.push(`**Tokens estimated:** ${result.metadata.total_tokens_estimated.toLocaleString()}  |  **Chunks:** ${result.metadata.chunks_processed}`);
  lines.push(``);
  lines.push(`## Synthesis`);
  lines.push(result.final_synthesis);

  if (issue?.dissent_preserved?.length) {
    lines.push(``);
    lines.push(`## Preserved Dissents`);
    issue.dissent_preserved.forEach((d) => lines.push(`- ${d}`));
  }

  if (issue?.objection_routes?.length) {
    lines.push(``);
    lines.push(`## Cross-Body Objections`);
    issue.objection_routes.forEach((o) => lines.push(`- ${o}`));
  }

  if (result.coverage_issues.length) {
    lines.push(``);
    lines.push(`## Coverage Warnings`);
    result.coverage_issues.forEach((c) => lines.push(`- ${c.material_lost}`));
  }

  return lines.join("\n");
}

const server = new Server(
  { name: "three-body-orchestrator", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "three_body_reason",
      description:
        "Run the Three-Body reasoning orchestrator: three DeepSeek model instances " +
        "(logic decomposition, adversarial challenge, structured validation) analyze " +
        "a query sequentially, cross-challenge each other's outputs, then synthesize " +
        "a final answer with a convergence status and confidence tier. " +
        "Best for complex questions, long documents, or decisions that benefit from " +
        "adversarial multi-perspective reasoning.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "The question, task, or decision to reason about. Sent to all three bodies.",
          },
          input_text: {
            type: "string",
            description:
              "Optional document, code, or context for the bodies to analyze. " +
              "If omitted, the query itself is the sole input.",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "three_body_reason") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as Record<string, unknown>;
  const query = String(args["query"] ?? "");
  const inputText = args["input_text"] != null ? String(args["input_text"]) : query;

  if (!query.trim()) {
    return {
      content: [{ type: "text" as const, text: "Error: query must not be empty." }],
      isError: true,
    };
  }

  const config = loadConfig();
  const result = await runThreeBody(query, inputText, config);

  return {
    content: [{ type: "text" as const, text: formatResult(result) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Three-Body MCP server fatal error: ${String(err)}\n`);
  process.exit(1);
});
