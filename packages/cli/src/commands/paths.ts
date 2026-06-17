import { resolve } from "node:path";

export function invocationCwd(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

export function resolveFromInvocationCwd(path: string): string {
  return resolve(invocationCwd(), path);
}
