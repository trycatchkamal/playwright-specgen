#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseTrace } from './parser/index.js';
import { mapFlowToApis } from './mapper/index.js';
import {
  generateFlowYaml,
  generateApiYaml,
  generateTestTs,
  generateEvidenceJson,
} from './generator/index.js';
import { ParseError } from './types/index.js';

type OutputKey = 'flow' | 'api' | 'test' | 'evidence';

const outputEnum = z.enum(['flow', 'api', 'test', 'evidence']);

const server = new McpServer({ name: 'playwright-specgen', version: '0.1.1' });

server.registerTool(
  'parse_trace',
  {
    description:
      'Parse a Playwright trace.zip file. Returns user flow YAML, API sequence YAML, ' +
      'a ready-to-run Playwright test (.spec.ts), and raw evidence JSON. ' +
      'Use "outputs" to request only what you need. Use "write_files" to also persist files to disk.',
    inputSchema: z.object({
      trace_path: z
        .string()
        .describe('Path to the Playwright trace.zip file (absolute or relative to cwd).'),
      outputs: z
        .array(outputEnum)
        .optional()
        .describe(
          'Which outputs to return. Defaults to all four: ["flow", "api", "test", "evidence"].'
        ),
      write_files: z
        .boolean()
        .optional()
        .describe(
          'If true, also write flows/, apis/, tests/, evidence/ files to disk (same as CLI). Defaults to false.'
        ),
    }),
  },
  async ({ trace_path, outputs, write_files }) => {
    const selectedOutputs: OutputKey[] = outputs ?? ['flow', 'api', 'test', 'evidence'];
    const tracePath = resolve(trace_path);

    let buffer: Buffer;
    try {
      buffer = readFileSync(tracePath);
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `File not found or unreadable: ${tracePath}\n${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }

    let parsed;
    try {
      parsed = await parseTrace(buffer);
    } catch (err) {
      const message = err instanceof ParseError ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Failed to parse trace: ${message}` }],
        isError: true,
      };
    }

    const flowName =
      basename(tracePath).replace(/\.zip$/i, '').replace(/\.trace$/i, '') || 'flow';
    const steps = mapFlowToApis(parsed.actions, parsed.networkCalls);
    const flow = { name: flowName, steps };

    const generated: Record<OutputKey, string> = {
      flow:     generateFlowYaml(flow),
      api:      generateApiYaml(parsed.networkCalls),
      test:     generateTestTs(flow),
      evidence: generateEvidenceJson(basename(tracePath), parsed),
    };

    const labels: Record<OutputKey, { heading: string; lang: string }> = {
      flow:     { heading: `flows/${flowName}.yaml`,          lang: 'yaml'       },
      api:      { heading: `apis/${flowName}.yaml`,           lang: 'yaml'       },
      test:     { heading: `tests/${flowName}.spec.ts`,       lang: 'typescript' },
      evidence: { heading: `evidence/${flowName}.trace.json`, lang: 'json'       },
    };

    const content: { type: 'text'; text: string }[] = selectedOutputs.map((key) => ({
      type: 'text' as const,
      text: `## ${labels[key].heading}\n\`\`\`${labels[key].lang}\n${generated[key]}\`\`\``,
    }));

    if (write_files) {
      const cwd = process.cwd();
      const dirs = {
        flows:    join(cwd, 'flows'),
        apis:     join(cwd, 'apis'),
        tests:    join(cwd, 'tests'),
        evidence: join(cwd, 'evidence'),
      };
      for (const dir of Object.values(dirs)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(join(dirs.flows,    `${flowName}.yaml`),       generated.flow);
      writeFileSync(join(dirs.apis,     `${flowName}.yaml`),       generated.api);
      writeFileSync(join(dirs.tests,    `${flowName}.spec.ts`),    generated.test);
      writeFileSync(join(dirs.evidence, `${flowName}.trace.json`), generated.evidence);

      content.push({
        type: 'text' as const,
        text: [
          '## Files written',
          `✓ flows/${flowName}.yaml`,
          `✓ apis/${flowName}.yaml`,
          `✓ tests/${flowName}.spec.ts`,
          `✓ evidence/${flowName}.trace.json`,
        ].join('\n'),
      });
    }

    return { content };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
