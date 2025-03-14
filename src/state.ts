// Runtime state is stored in this file.
// TODO: reactive state?

import * as vscode from "vscode";
import { BASE_BRANCH_REGEX, DEV_BRANCH_REGEX, LINE_BREAK_REGEX } from "./constants";
import { ContextualUtils } from "./contextualUtils";
import { runShellCommand } from "./helpers";

const debugSessions: vscode.DebugSession[] = [];
const baseBranches: string[] = [];
const devBranches: Record<string, { name: string }[]> = {};

export function getDebugSessions() {
  return debugSessions;
}

export async function initBaseBranches(utils: ContextualUtils) {
  const result = await runShellCommand("git branch", {
    cwd: utils.getRepoPath(utils.odevRepos.odoo),
  });
  const extractedBranches = extractBranchList(result);
  const branches = extractedBranches.filter((name) => BASE_BRANCH_REGEX.test(name));
  for (const branch of branches) {
    baseBranches.push(branch);
  }
}

export async function initDevBranches(utils: ContextualUtils): Promise<void> {
  const odooRepo = utils.getRepoPath(utils.odevRepos.odoo);
  const upgradeRepo = utils.odevRepos.upgrade
    ? utils.getRepoPath(utils.odevRepos.upgrade)
    : undefined;

  const branchSet = new Set<string>();

  for (const branch of [...(await getBranches(odooRepo))]) {
    if (DEV_BRANCH_REGEX.test(branch)) {
      branchSet.add(branch);
    }
  }

  for (const [, repo] of Object.entries(utils.odevRepos.custom)) {
    for (const branch of [...(await getBranches(utils.getRepoPath(repo)))]) {
      if (DEV_BRANCH_REGEX.test(branch)) {
        branchSet.add(branch);
      }
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
      const base = check[1].replace(/[-_]$/, "");
      if (!(base in devBranches)) {
        devBranches[base] = [];
      }
      devBranches[base].push({ name: branch });
    }
  }
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

function exists<T>(items: T[], pred: (x: T) => boolean): boolean {
  for (const item of items) {
    if (pred(item)) {
      return true;
    }
  }
  return false;
}

//#endregion
