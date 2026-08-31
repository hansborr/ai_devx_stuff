import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DEVCONTAINER_DIR = path.resolve(__dirname, "../.devcontainer");

function readDevcontainerFile(name: string): string {
  return readFileSync(path.join(DEVCONTAINER_DIR, name), "utf8");
}

/** Build-context sources of every `COPY` in the Dockerfile (all tokens but the destination). */
function dockerfileCopySources(): string[] {
  return readDevcontainerFile("Dockerfile")
    .split("\n")
    .filter((line) => line.startsWith("COPY "))
    .flatMap((line) => line.split(/\s+/).slice(1, -1));
}

describe(".devcontainer server-start path", () => {
  it("copies only build-context files that exist", () => {
    // A COPY of a deleted script fails the image build at line one, and no lint
    // in this repo reads the Dockerfile's build context.
    const missing = dockerfileCopySources().filter(
      (source) => !existsSync(path.join(DEVCONTAINER_DIR, source)),
    );
    expect(missing).toEqual([]);
  });

  it("ships exactly one server-start helper, the one compose runs", () => {
    // Two installed start paths let the unused one's startup contract drift away
    // from the supported one. `container-entrypoint.sh` is the sole supported
    // path; see .devcontainer/README.md "Prerequisites".
    const starters = dockerfileCopySources().filter((source) => source.endsWith(".sh"));
    expect(starters).toEqual(["container-entrypoint.sh"]);
    expect(readDevcontainerFile("docker-compose.yml")).toContain(
      "command: /usr/local/bin/container-entrypoint.sh",
    );
  });

  it("gates that helper on the post-create setup sentinel", () => {
    // The consolidation is only safe because the surviving path is the gated one.
    expect(readDevcontainerFile("container-entrypoint.sh")).toContain("/workspace/.setup-complete");
  });
});

const README = readDevcontainerFile("README.md");
const COMPOSE = readDevcontainerFile("docker-compose.yml");

/** The image the Dockerfile builds on, which this repository does not contain. */
function baseImage(): string {
  const match = readDevcontainerFile("Dockerfile").match(/^FROM (\S+)/m);
  if (match?.[1] === undefined) throw new Error("no FROM line in .devcontainer/Dockerfile");
  return match[1];
}

/** The systemd slice compose parents the pod into, supplied by external host setup. */
function cgroupParent(): string {
  const match = COMPOSE.match(/--cgroup-parent=([^"]+)"/);
  if (match?.[1] === undefined) throw new Error("no --cgroup-parent in docker-compose.yml");
  return match[1];
}

/** Volume names compose declares `external: true` — Podman refuses to create these. */
function externalVolumes(): string[] {
  const volumesBlock = COMPOSE.slice(COMPOSE.indexOf("\nvolumes:\n"));
  return [...volumesBlock.matchAll(/^ {2}([\w-]+):\n {4}external: true$/gm)].map(
    (match) => match[1] ?? "",
  );
}

/** Supplied by the base image, invoked by `postStartCommand` — neither is in this repo. */
const FIREWALL_SCRIPT = "/usr/local/bin/init-firewall.sh";

/** Every variable name `.env.example` ships, in file order. */
function envExampleKeys(): string[] {
  return [...readDevcontainerFile(".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
    (match) => match[1] ?? "",
  );
}

function devcontainerJson(): {
  initializeCommand: string;
  postStartCommand: string;
  forwardPorts: number[];
} {
  // Plain JSON, not jsonc, by the coverage manifest's `devcontainer-devcontainer-json` entry.
  return JSON.parse(readDevcontainerFile("devcontainer.json"));
}

/** The reuse checklist an outside adopter works through, both of its tables. */
function reuseChecklist(): string {
  return README.slice(README.indexOf("\n## Reusing this setup in another project\n"));
}

describe(".devcontainer/README.md Prerequisites", () => {
  it("comes before the Quick start it gates", () => {
    // A prerequisite read after the failing step is a post-mortem, not a prerequisite.
    const prerequisites = README.indexOf("\n## Prerequisites\n");
    const quickStart = README.indexOf("\n## Quick start\n");
    expect(prerequisites).toBeGreaterThan(-1);
    expect(prerequisites).toBeLessThan(quickStart);
  });

  it("names every host dependency the repository does not ship", () => {
    // Hand-maintained prose over compose/Dockerfile facts: pin it to the literal
    // values so a rename in either file fails here instead of misleading a reader.
    expect(README).toContain(baseImage());
    expect(README).toContain(cgroupParent());
    // Pinned to the literal path, not to a positional token of `postStartCommand`:
    // reordering or appending a step must not silently retarget this assertion.
    expect(devcontainerJson().postStartCommand).toContain(FIREWALL_SCRIPT);
    expect(README).toContain(FIREWALL_SCRIPT);
    expect(externalVolumes()).not.toEqual([]);
    for (const volume of externalVolumes()) {
      expect(README).toContain(`\`${volume}\``);
    }
  });

  it("lists every forwarded port in the reuse checklist", () => {
    // The checklist is only useful to an outside adopter if it is exhaustive.
    for (const port of devcontainerJson().forwardPorts) {
      expect(reuseChecklist()).toContain(String(port));
    }
  });

  it("accounts for every key an adopter copies out of .env.example", () => {
    // `.env.example` hand-duplicates credentials, service names, and a port into
    // the connection URLs. A key the checklist never names is a value the adopter
    // leaves at Musi's default and only discovers when Prisma or CORS fails.
    const unlisted = envExampleKeys().filter((key) => !reuseChecklist().includes(`\`${key}\``));
    expect(unlisted).toEqual([]);
  });
});

describe(".devcontainer/devcontainer.json initializeCommand", () => {
  it("provisions every external volume idempotently", () => {
    // `external: true` means Podman will not create it, so first start fails until
    // something does. `--ignore` keeps a host-managed volume untouched.
    const { initializeCommand } = devcontainerJson();
    for (const volume of externalVolumes()) {
      expect(initializeCommand).toContain(`podman volume create --ignore ${volume}`);
    }
  });
});

/**
 * Host path a Compose file's `db` service mounts at the postgres initdb hook,
 * resolved from that file's own directory as Compose resolves it.
 */
function initSqlMountSource(composePath: string): string {
  const mount = readFileSync(composePath, "utf8").match(
    // The container path anchors the match and any mount-flag suffix is
    // ignored: read-only-ness is not the invariant this test owns, so pinning
    // the flags would turn a good-faith edit (adding the `,z` SELinux label the
    // other host binds in this compose file already carry) into a false failure.
    /- (\S+):\/docker-entrypoint-initdb\.d\/init-test-db\.sql(?::\S+)?$/m,
  );
  if (mount?.[1] === undefined) throw new Error(`no init-test-db.sql mount in ${composePath}`);
  return path.resolve(path.dirname(composePath), mount[1]);
}

describe("test-database bootstrap SQL", () => {
  it("is a single file both Compose stacks mount", () => {
    // Two copies drift in silence: either is editable alone, both stay valid
    // SQL, and the two environments start provisioning different test databases
    // — surfacing much later as a vitest or Playwright suite that finds a
    // database in one environment and not the other.
    const root = initSqlMountSource(path.resolve(__dirname, "../docker-compose.yml"));
    expect(initSqlMountSource(path.join(DEVCONTAINER_DIR, "docker-compose.yml"))).toBe(root);
    // A mount source that resolves to nothing fails silently: Compose short
    // syntax creates a missing host path (as a directory) rather than refusing
    // to start, and the initdb hook is skipped outright on an already
    // initialized data volume — so a deleted or moved file surfaces only when
    // some later fresh volume comes up with no test databases.
    expect(existsSync(root)).toBe(true);
  });
});
