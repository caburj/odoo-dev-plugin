import * as vscode from "vscode";

type DevBranch = { name: string };
type DevBranchInput = {
  base: string;
  name: string;
};

function exists<T>(items: T[], pred: (x: T) => boolean): boolean {
  for (const item of items) {
    if (pred(item)) {
      return true;
    }
  }
  return false;
}

export class OdooPluginDB {
  private static baseBranchesKey = "base-branches";
  constructor(private globalState: vscode.ExtensionContext["globalState"]) {
    const baseBranches = this.globalState.get(OdooPluginDB.baseBranchesKey);
    if (!baseBranches) {
      this.globalState.update(OdooPluginDB.baseBranchesKey, []);
    }
  }
  devBranchExists({ base, name }: DevBranchInput): boolean {
    const devBranches = this.getDevBranches(base);
    return exists(devBranches, (dv) => dv.name === name);
  }
  addDevBranch({ base, name }: DevBranchInput) {
    const devBranches = this.getDevBranches(base);
    devBranches.push({ name });
    this.globalState.update(base, [...devBranches]);
  }
  getDevBranches(base: string): DevBranch[] {
    return this.globalState.get(base, []) as DevBranch[];
  }
  removeDevBranch({ base, name }: DevBranchInput) {
    const devBranches = this.getDevBranches(base);
    if (!exists(devBranches, (x) => x.name === name)) {
      throw new Error(`'${name}' doesn't exist.`);
    }
    this.globalState.update(
      base,
      devBranches.filter((dv) => dv.name !== name)
    );
  }
}
