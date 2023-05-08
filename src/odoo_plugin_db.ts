import * as vscode from "vscode";
import { getBaseBranches } from "./helpers";

type DevBranch = { name: string };
type DevBranchInput = {
  base: string;
  name: string;
};

type Version = (typeof VERSIONS)[number];
type MigrationScript = (db: OdooPluginDB) => Version | void;

// Top-level contants
const VERSION = "ODOO_DEV_PLUGIN_VERSION";
const ACTIVE_BRANCH = "ACTIVE_BRANCH";
const SEP = "||+||";

function getKey(key: string) {
  const sourceFolder = vscode.workspace.getConfiguration("odooDev").sourceFolder as string;
  return `${sourceFolder}${SEP}${key}`;
}

/**
 * Whenever the schema of the db changes:
 * 1. Update the value of `CURRENT_VERSION`
 * 2. Manually append it to the list of `versions`
 * 3. Write the migration script in `migrationScripts`. It will be a function
 *    corresponding to the previous version which returns the new version.
 * 4. Add a new key in the `migrationScripts` that has a no-op value.
 */
const CURRENT_VERSION: Version = "v1";
const VERSIONS = ["v0", "v1"] as const;
const MIGRATION_SCRIPTS: Record<Version, MigrationScript> = {
  v0: (db: OdooPluginDB) => {
    const gs = db.globalState;

    const activeBranch = gs.get("active-branch") as string;
    gs.update(getKey(ACTIVE_BRANCH), activeBranch);

    const baseBranches = getBaseBranches();

    for (const base of baseBranches) {
      const devBranches = gs.get(base) as DevBranch[];
      gs.update(getKey(base), devBranches);
    }

    return "v1"; // Return the next version.
  },
  v1: () => {}, // Always assign a no-op for the latest version.
};

function getMigrationScript(version: Version): MigrationScript {
  const cb = MIGRATION_SCRIPTS[version];
  return (db: OdooPluginDB): Version | void => {
    try {
      const result = cb(db);
      if (result) {
        db.setVersion(result);
      }
    } catch (error) {
      throw new Error(`Failed to migrate from ${version}. Reason: '${(error as Error).message}'`);
    }
  };
}

function doMigrationChain(db: OdooPluginDB, fromVersion: Version, toVersion: Version) {
  let script = getMigrationScript(fromVersion);
  let nextVersion: Version | void;
  while ((nextVersion = script(db))) {
    if (nextVersion === toVersion) {
      break; // done
    }
    script = getMigrationScript(nextVersion);
  }
}

export function migrate(db: OdooPluginDB) {
  let version = db.getVersion();
  if (!version) {
    // If no version, it means that we just started using the plugin.
    version = CURRENT_VERSION;
    db.setVersion(CURRENT_VERSION);
  }
  if (version !== CURRENT_VERSION) {
    doMigrationChain(db, version, CURRENT_VERSION);
    console.log(`Migration from '${version}' to '${CURRENT_VERSION}' is successful.`);
  } else {
    console.log(`${OdooPluginDB.name} version '${CURRENT_VERSION}' is up-to-date.`);
  }
}

function exists<T>(items: T[], pred: (x: T) => boolean): boolean {
  for (const item of items) {
    if (pred(item)) {
      return true;
    }
  }
  return false;
}

export class OdooPluginDB {
  globalState: vscode.ExtensionContext["globalState"];
  constructor(public context: vscode.ExtensionContext) {
    this.globalState = this.context["globalState"];
  }
  setVersion(newVersion: Version) {
    this.globalState.update(VERSION, newVersion);
  }
  getVersion() {
    return this.globalState.get(VERSION) as Version | undefined;
  }
  setActiveBranch(branch?: string) {
    this.globalState.update(getKey(ACTIVE_BRANCH), branch);
  }
  getActiveBranch(): string | undefined {
    return this.globalState.get(getKey(ACTIVE_BRANCH));
  }
  devBranchExists({ base, name }: DevBranchInput): boolean {
    const devBranches = this.getDevBranches(base);
    return exists(devBranches, (dv) => dv.name === name);
  }
  addDevBranch({ base, name }: DevBranchInput) {
    const devBranches = this.getDevBranches(base);
    devBranches.push({ name });
    this.globalState.update(getKey(base), [...devBranches]);
  }
  getDevBranches(base: string): DevBranch[] {
    return this.globalState.get(getKey(base), []) as DevBranch[];
  }
  removeDevBranch({ base, name }: DevBranchInput) {
    const devBranches = this.getDevBranches(base);
    if (!exists(devBranches, (x) => x.name === name)) {
      throw new Error(`'${name}' doesn't exist.`);
    }
    this.globalState.update(
      getKey(base),
      devBranches.filter((dv) => dv.name !== name)
    );
  }
}
