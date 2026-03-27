#!/usr/bin/env node
import { buildProgram } from './cli/index.js';

const program = buildProgram();
await program.parseAsync(process.argv);
