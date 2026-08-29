export type ViewerPortEnv = {
  CONDUCTOR_PORT?: string;
  VIEWER_PORT?: string;
  VITE_PORT?: string;
};

export type ViewerPorts = {
  apiPort: number;
  clientPort: number;
};

function parsePort(name: keyof ViewerPortEnv, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a valid TCP port (decimal integer from 1 to 65535).`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port (decimal integer from 1 to 65535).`);
  }
  return port;
}

export function resolveViewerPorts(env: ViewerPortEnv): ViewerPorts {
  let apiPort = 3001;
  let clientPort = 5173;

  if (env.CONDUCTOR_PORT !== undefined) {
    const conductorPort = parsePort('CONDUCTOR_PORT', env.CONDUCTOR_PORT);
    if (conductorPort === 65535) {
      throw new Error('CONDUCTOR_PORT must be a valid TCP port with an adjacent frontend port.');
    }
    apiPort = conductorPort;
    clientPort = conductorPort + 1;
  }

  if (env.VIEWER_PORT !== undefined) apiPort = parsePort('VIEWER_PORT', env.VIEWER_PORT);
  if (env.VITE_PORT !== undefined) clientPort = parsePort('VITE_PORT', env.VITE_PORT);

  return { apiPort, clientPort };
}
