import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncConfigs } from './config.mjs';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
  console.error('Usage: node scripts/agent/sync-config.mjs --check|--write');
  process.exitCode = 2;
} else {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
    const root = stdout.trim();
    const { drift } = await syncConfigs({ root, write: args[0] === '--write' });

    if (drift.length === 0) {
      console.log('MCP adapters are synchronized.');
    } else if (args[0] === '--check') {
      console.error(`MCP adapter drift: ${drift.join(', ')}`);
      process.exitCode = 1;
    } else {
      for (const path of drift) console.log(`Updated ${path}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
