import * as vscode from 'vscode';

type BaseBranch = { name: string; sequence: number };
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
  private static baseBranchesKey = 'base-branches';
  constructor(private globalState: vscode.ExtensionContext['globalState']) {
    const baseBranches = this.globalState.get(OdooPluginDB.baseBranchesKey);
    if (!baseBranches) {
      this.globalState.update(OdooPluginDB.baseBranchesKey, []);
    }
  }
  baseBranchExists(name: string) {
    return exists(this.getBaseBranches(), (bb) => bb.name === name);
  }
  addBaseBranch({ name, sequence }: { name: string; sequence?: number }) {
    const baseBranches = this.getBaseBranches();
    // invariance, baseBranches is always sorted.
    if (baseBranches.length === 0) {
      baseBranches.push({ name, sequence: sequence || 0 });
    } else {
      if (exists(baseBranches, (bb) => bb.name === name)) {
        throw new Error(`'${name}' already exists.`);
      }
      const seq =
        sequence === undefined
          ? baseBranches[baseBranches.length - 1]['sequence'] + 10
          : sequence;
      baseBranches.push({ name, sequence: seq });
      baseBranches.sort((a, b) => a['sequence'] - b['sequence']);
    }
    this.globalState.update(OdooPluginDB.baseBranchesKey, [...baseBranches]);
  }
  removeBaseBranch(name: string) {
    const baseBranches = this.getBaseBranches();
    if (!exists(baseBranches, (bb) => bb.name === name)) {
      throw new Error(`'${name}' doesn't exist.`);
    }
    this.globalState.update(
      OdooPluginDB.baseBranchesKey,
      baseBranches.filter((bb) => bb.name !== name)
    );
    this.globalState.update(name, undefined);
  }
  getBaseBranches(): BaseBranch[] {
    const baseBranches = this.globalState.get(
      OdooPluginDB.baseBranchesKey,
      []
    ) as BaseBranch[];
    return baseBranches;
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
