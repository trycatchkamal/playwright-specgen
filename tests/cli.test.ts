import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildLoginTraceZip, buildCheckoutTraceZip } from './fixtures/buildFixture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// On Windows, pnpm creates .cmd shims; on Unix it's just 'tsx'
const TSX_BIN = process.platform === 'win32'
  ? join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx.cmd')
  : join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const CLI_ENTRY = join(PROJECT_ROOT, 'src', 'index.ts');

// Helper: run CLI via tsx and return { stdout, stderr, code }
function runCli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`"${TSX_BIN}" "${CLI_ENTRY}" ${args}`, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: e.status ?? 1,
    };
  }
}

describe('CLI --stdout flag', () => {
  let tmpDir: string;
  let traceFile: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `playwright-specgen-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const zip = await buildLoginTraceZip();
    traceFile = join(tmpDir, 'trace.zip');
    writeFileSync(traceFile, zip);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--stdout prints JSON to stdout', () => {
    const { stdout, code } = runCli(`parse trace.zip --stdout`, tmpDir);
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('stdout JSON contains flowYaml, apiYaml, testTs, evidenceJson keys', () => {
    const { stdout } = runCli(`parse trace.zip --stdout`, tmpDir);
    const result = JSON.parse(stdout);

    expect(result).toHaveProperty('flowYaml');
    expect(result).toHaveProperty('apiYaml');
    expect(result).toHaveProperty('testTs');
    expect(result).toHaveProperty('evidenceJson');
  });

  it('--stdout does not write any files to disk', () => {
    runCli(`parse trace.zip --stdout`, tmpDir);

    expect(existsSync(join(tmpDir, 'flows'))).toBe(false);
    expect(existsSync(join(tmpDir, 'apis'))).toBe(false);
    expect(existsSync(join(tmpDir, 'tests'))).toBe(false);
    expect(existsSync(join(tmpDir, 'evidence'))).toBe(false);
  });
});

describe('CLI file output (no flag)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `playwright-specgen-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const zip = await buildLoginTraceZip();
    // Name the file login.zip so outputs become login.yaml / login.spec.ts
    writeFileSync(join(tmpDir, 'login.zip'), zip);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes flows/login.yaml', () => {
    runCli(`parse login.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'flows', 'login.yaml'))).toBe(true);
  });

  it('writes apis/login.yaml', () => {
    runCli(`parse login.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'apis', 'login.yaml'))).toBe(true);
  });

  it('writes tests/login.spec.ts', () => {
    runCli(`parse login.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'tests', 'login.spec.ts'))).toBe(true);
  });

  it('writes evidence/login.trace.json', () => {
    runCli(`parse login.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'evidence', 'login.trace.json'))).toBe(true);
  });

  it('written flows/login.yaml is valid YAML with flow key', () => {
    runCli(`parse login.zip`, tmpDir);
    const content = readFileSync(join(tmpDir, 'flows', 'login.yaml'), 'utf8');
    expect(content).toContain('flow:');
    expect(content).toContain('steps:');
  });
});

describe('CLI file output - checkout flow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `playwright-specgen-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const zip = await buildCheckoutTraceZip();
    writeFileSync(join(tmpDir, 'checkout.zip'), zip);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes flows/checkout.yaml', () => {
    runCli(`parse checkout.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'flows', 'checkout.yaml'))).toBe(true);
  });

  it('writes apis/checkout.yaml', () => {
    runCli(`parse checkout.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'apis', 'checkout.yaml'))).toBe(true);
  });

  it('writes tests/checkout.spec.ts', () => {
    runCli(`parse checkout.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'tests', 'checkout.spec.ts'))).toBe(true);
  });

  it('writes evidence/checkout.trace.json', () => {
    runCli(`parse checkout.zip`, tmpDir);
    expect(existsSync(join(tmpDir, 'evidence', 'checkout.trace.json'))).toBe(true);
  });

  it('checkout.spec.ts contains correct flow name and URL assertion', () => {
    runCli(`parse checkout.zip`, tmpDir);
    const content = readFileSync(join(tmpDir, 'tests', 'checkout.spec.ts'), 'utf8');
    expect(content).toContain("test('checkout flow'");
    expect(content).toContain("toHaveURL('/order/confirm')");
  });
});

describe('CLI error handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `playwright-specgen-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits with code 1 if file not found', () => {
    const { code } = runCli(`parse nonexistent.zip`, tmpDir);
    expect(code).toBe(1);
  });

  it('prints error message to stderr when file not found', () => {
    const { stderr } = runCli(`parse nonexistent.zip`, tmpDir);
    expect(stderr.toLowerCase()).toMatch(/error|not found|no such/);
  });
});
