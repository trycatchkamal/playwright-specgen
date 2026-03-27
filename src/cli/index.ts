import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, basename, join } from 'path';
import { parseTrace } from '../parser/index.js';
import { mapFlowToApis } from '../mapper/index.js';
import { generateFlowYaml, generateApiYaml, generateTestTs, generateEvidenceJson } from '../generator/index.js';
import type { GeneratedOutput } from '../types/index.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('playwright-specgen')
    .description('Turn Playwright trace.zip into flows, API sequences, and tests')
    .version('0.1.0');

  program
    .command('parse <traceFile>')
    .description('Parse a Playwright trace.zip file')
    .option('--stdout', 'Print output as JSON to stdout instead of writing files')
    .action(async (traceFile: string, options: { stdout?: boolean }) => {
      const filePath = resolve(traceFile);

      let buffer: Buffer;
      try {
        buffer = readFileSync(filePath);
      } catch (err) {
        process.stderr.write(
          `Error: File not found or unreadable: ${filePath}\n${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(1);
      }

      let parsed;
      try {
        parsed = await parseTrace(buffer);
      } catch (err) {
        process.stderr.write(
          `Error: Failed to parse trace file: ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(1);
      }

      // Derive flow name from the trace filename (strip extension)
      const flowName = basename(filePath).replace(/\.zip$/i, '').replace(/\.trace$/i, '') || 'flow';

      const steps = mapFlowToApis(parsed.actions, parsed.networkCalls);

      const flow = { name: flowName, steps };

      const output: GeneratedOutput = {
        flowYaml: generateFlowYaml(flow),
        apiYaml: generateApiYaml(parsed.networkCalls),
        testTs: generateTestTs(flow),
        evidenceJson: generateEvidenceJson(basename(filePath), parsed),
      };

      if (options.stdout) {
        process.stdout.write(JSON.stringify(output) + '\n');
        return;
      }

      // Write to output directories relative to cwd
      const cwd = process.cwd();

      const dirs = {
        flows: join(cwd, 'flows'),
        apis: join(cwd, 'apis'),
        tests: join(cwd, 'tests'),
        evidence: join(cwd, 'evidence'),
      };

      for (const dir of Object.values(dirs)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(join(dirs.flows, `${flowName}.yaml`), output.flowYaml);
      writeFileSync(join(dirs.apis, `${flowName}.yaml`), output.apiYaml);
      writeFileSync(join(dirs.tests, `${flowName}.spec.ts`), output.testTs);
      writeFileSync(join(dirs.evidence, `${flowName}.trace.json`), output.evidenceJson);

      process.stdout.write(`✓ flows/${flowName}.yaml\n`);
      process.stdout.write(`✓ apis/${flowName}.yaml\n`);
      process.stdout.write(`✓ tests/${flowName}.spec.ts\n`);
      process.stdout.write(`✓ evidence/${flowName}.trace.json\n`);
    });

  return program;
}
