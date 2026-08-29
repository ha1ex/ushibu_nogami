import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerPorts } from './ports.js';

test('uses adjacent Conductor workspace ports', () => {
  assert.deepEqual(resolveViewerPorts({ CONDUCTOR_PORT: '4400' }), {
    apiPort: 4400,
    clientPort: 4401,
  });
});

test('explicit viewer ports override Conductor', () => {
  assert.deepEqual(
    resolveViewerPorts({ CONDUCTOR_PORT: '4400', VIEWER_PORT: '5500', VITE_PORT: '6600' }),
    { apiPort: 5500, clientPort: 6600 },
  );
});

test('explicit ports override Conductor independently', () => {
  assert.deepEqual(resolveViewerPorts({ CONDUCTOR_PORT: '4400', VIEWER_PORT: '5500' }), {
    apiPort: 5500,
    clientPort: 4401,
  });
  assert.deepEqual(resolveViewerPorts({ CONDUCTOR_PORT: '4400', VITE_PORT: '6600' }), {
    apiPort: 4400,
    clientPort: 6600,
  });
});

test('uses standalone defaults', () => {
  assert.deepEqual(resolveViewerPorts({}), { apiPort: 3001, clientPort: 5173 });
});

test('rejects non-decimal and out-of-range selected ports', () => {
  for (const env of [
    { CONDUCTOR_PORT: '0' },
    { CONDUCTOR_PORT: '65535' },
    { CONDUCTOR_PORT: '12.5' },
    { VIEWER_PORT: '0' },
    { VIEWER_PORT: '0x1000' },
    { VITE_PORT: '65536' },
    { VITE_PORT: ' 5173' },
  ]) {
    assert.throws(() => resolveViewerPorts(env), /valid TCP port/i);
  }
});
