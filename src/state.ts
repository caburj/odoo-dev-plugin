// Runtime state is stored in this file.
// TODO: reactive state?

import * as vscode from "vscode";
import { BASE_BRANCH_REGEX, DEV_BRANCH_REGEX, LINE_BREAK_REGEX } from "./constants";
import { ContextualUtils } from "./contextualUtils";
import { runShellCommand } from "./helpers";

const debugSessions: vscode.DebugSession[] = [];
const baseBranches: string[] = [];
const devBranches: Record<string, { name: string }[]> = {};
let activeBranch: string | undefined;

export function getDebugSessions() {
  return debugSessions;
}

export async function initBaseBranches(utils: ContextualUtils) {
  const result = await runShellCommand("git branch", { cwd: utils.getRepoPath("odoo") });
  const extractedBranches = extractBranchList(result);
  const branches = extractedBranches.filter((name) => BASE_BRANCH_REGEX.test(name));
  for (const branch of branches) {
    baseBranches.push(branch);
  }
}

export async function initDevBranches(utils: ContextualUtils): Promise<void> {
  const odooRepo = utils.getRepoPath("odoo");
  const enterpriseRepo = utils.getRepoPath("enterprise");
  const upgradeRepo = utils.getRepoPath("upgrade");

  const branchSet = new Set<string>();

  for (const branch of [...(await getBranches(odooRepo))]) {
    if (DEV_BRANCH_REGEX.test(branch)) {
      branchSet.add(branch);
    }
  }
  for (const branch of [...(!enterpriseRepo ? [] : await getBranches(enterpriseRepo))]) {
    if (DEV_BRANCH_REGEX.test(branch)) {
      branchSet.add(branch);
    }
  }
  for (const branch of [...(!upgradeRepo ? [] : await getBranches(upgradeRepo))]) {
    if (DEV_BRANCH_REGEX.test(branch)) {
      branchSet.add(branch);
    }
  }

  for (const branch of branchSet) {
    const check = branch.match(DEV_BRANCH_REGEX);
    if (check) {
      const base = check[1].replace(/-$/, "");
      if (!(base in devBranches)) {
        devBranches[base] = [];
      }
      devBranches[base].push({ name: branch });
    }
  }
}

export async function initActiveBranch(utils: ContextualUtils) {
  const odooRepo = utils.getRepoPath("odoo");
  const enterpriseRepo = utils.getRepoPath("enterprise");
  const upgradeRepo = utils.getRepoPath("upgrade");
  const odooActive = await runShellCommand("git branch --show-current", {
    cwd: odooRepo,
  });
  const entepriseActive = enterpriseRepo
    ? await runShellCommand("git branch --show-current", { cwd: enterpriseRepo })
    : "";
  const upgradeActive = upgradeRepo
    ? await runShellCommand("git branch --show-current", { cwd: upgradeRepo })
    : "";

  const activeBranches = [odooActive, entepriseActive, upgradeActive].map((b) => b.trim());
  const unique = [...new Set(activeBranches.filter((b) => b))];
  if (unique.length === 1) {
    activeBranch = unique[0];
  } else if (unique.length === 2) {
    const [o, e, u] = activeBranches;
    if (o === e) {
      if (u === "master") {
        activeBranch = o;
      }
    } else if (o === u) {
      if (u === "master" && DEV_BRANCH_REGEX.test(e)) {
        activeBranch = e;
      } else {
        // Something is wrong. Don't assume an active branch.
      }
    } else if (e === u) {
      if (u === "master" && DEV_BRANCH_REGEX.test(o)) {
        activeBranch = o;
      } else {
        // Something is wrong. Don't assume an active branch.
      }
    }
  } else if (unique.length === 3) {
    const [o, e, u] = activeBranches;
    if (u === "master") {
      // it's either o or e
      if (DEV_BRANCH_REGEX.test(o)) {
        activeBranch = o;
      } else {
        activeBranch = e;
      }
    } else {
      // it's either of the three
      if (DEV_BRANCH_REGEX.test(o) && getBase(o) === e) {
        activeBranch = o;
      } else if (DEV_BRANCH_REGEX.test(e) && getBase(e) === o) {
        activeBranch = e;
      } else if (DEV_BRANCH_REGEX.test(u)) {
        activeBranch = u;
      }
    }
  }
}

export function getActiveBranch() {
  return activeBranch;
}

export function setActiveBranch(branch: string) {
  activeBranch = branch;
}

export function getBaseBranches() {
  return baseBranches;
}

export function addBaseBranch(branch: string) {
  if (!baseBranches.includes(branch)) {
    baseBranches.push(branch);
  }
}

export function removeBaseBranch(branch: string) {
  const index = baseBranches.indexOf(branch);
  if (index !== -1) {
    baseBranches.splice(index, 1);
  }
}

export function getDevBranches(base: string) {
  return devBranches[base] || [];
}

export function addDevBranch(base: string, branch: string) {
  if (!(base in devBranches)) {
    devBranches[base] = [];
  }
  if (!devBranches[base].some((b) => b.name === branch)) {
    devBranches[base].push({ name: branch });
  }
}

export function removeDevBranch(base: string, branch: string) {
  if (base in devBranches) {
    const index = devBranches[base].findIndex((b) => b.name === branch);
    if (index !== -1) {
      devBranches[base].splice(index, 1);
    }
  }
}

export function devBranchExists({ base, name }: { base: string; name: string }): boolean {
  const devBranches = getDevBranches(base);
  return exists(devBranches, (dv) => dv.name === name);
}

//#region helpers

function extractBranchList(output: string): string[] {
  return output
    .trim()
    .split(LINE_BREAK_REGEX)
    .map((line) => line.replace("*", "").trim());
}

async function getBranches(repoPath: string): Promise<string[]> {
  const odooOutput = await runShellCommand("git branch", { cwd: repoPath });
  return extractBranchList(odooOutput);
}

function getBase(branch: string) {
  const check = branch.match(DEV_BRANCH_REGEX);
  if (check) {
    return check[1].replace(/-$/, "");
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

//#endregion
