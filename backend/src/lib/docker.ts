import Docker from "dockerode";
import { config } from "../config.js";

/**
 * Delt Dockerode-klient.
 *
 * Dokploy kjører mot Docker Swarm og bruker `createService`. Snoat kjører mot en
 * enkelt daemon med vanlige containere (03_deployment_flow.md steg 4), så vi
 * bruker `createContainer` og kobler containeren på apps-nettverket i stedet.
 */
const socketPath = config.DOCKER_HOST.startsWith("unix://")
  ? config.DOCKER_HOST.slice("unix://".length)
  : undefined;

export const docker = socketPath ? new Docker({ socketPath }) : new Docker();

export async function ping(): Promise<void> {
  await docker.ping();
}

/**
 * Sikrer at nettverket brukerapplikasjonene kobles til finnes.
 *
 * Nettverket opprettes normalt av docker-compose, men backend kan kjøres
 * frittstående under utvikling.
 */
export async function ensureAppsNetwork(): Promise<void> {
  const name = config.SNOAT_APPS_NETWORK;
  const networks = await docker.listNetworks({ filters: { name: [name] } });

  if (networks.some((network) => network.Name === name)) return;

  await docker.createNetwork({ Name: name, Driver: "bridge" });
}
