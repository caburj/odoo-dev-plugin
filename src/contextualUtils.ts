import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as ini from "ini";
import * as Result from "./Result";
import { Branch, ForcePushMode, Remote, Repository } from "./dependencies/git";
import { OdooDevBranch, OdooDevBranches } from "./odoo_dev_branch";
import {
  findRemote,
  getChildProcs,
  inferBaseBranch,
  isOdooServer,
  killOdooServer,
  tryRunShellCommand,
  runShellCommand,
  getAddons,
  getRemoteOfBase,
  getBase,
  OdooDevRepositories,
  isBase,
  getRequirements,
} from "./helpers";
import { assert } from "console";
import {
  BASE_BRANCH_REGEX,
  DEBUG_JS_NAME,
  DEV_BRANCH_REGEX,
  FETCH_URL_REGEX,
  ODOO_SERVER_TERMINAL,
  ODOO_SHELL_TERMINAL,
} from "./constants";
import { OdooAddonsTree } from "./odoo_addons";
import { getBaseBranches, getDebugSessions, getDevBranches } from "./state";
import { withProgress } from "./decorators";

export type ContextualUtils = ReturnType<typeof createContextualUtils>;

async function taggedCall<L, T>(tag: L, cb: () => Promise<T>): Promise<{ tag: L; result: T }> {
  const result = await cb();
  return { tag, result };
}

async function getBranch(repo: Repository, name: string): Promise<Branch | undefined> {
  try {
    return await repo.getBranch(name);
  } catch (error) {
    return undefined;
  }
}

export function createContextualUtils(
  context: vscode.ExtensionContext,
  options: {
    odooServerStatus: vscode.StatusBarItem;
    addonsPathMap: Record<string, string>;
    getPythonPath: () => Promise<string>;
    getRepoPath: (repo: Repository) => string;
    odevRepos: OdooDevRepositories;
  }
) {
  const { odooServerStatus, addonsPathMap, getPythonPath, getRepoPath, odevRepos } = options;

  const odooDevTerminals = new Map<string, vscode.Terminal>();

  const getOdooDevTerminal = (name: string) => {
    let terminal = odooDevTerminals.get(name);
    if (!terminal) {
      const existingTerminals = vscode.window.terminals.filter((t) => t.name === name);
      if (existingTerminals.length > 0) {
        terminal = existingTerminals[0];
      } else {
        terminal = vscode.window.createTerminal({
          name,
          cwd: getRepoPath(odevRepos.odoo),
        });
        vscode.window.onDidCloseTerminal((t) => {
          if (t === terminal) {
            terminal = undefined;
          }
        });
      }
      terminal.show();
    }
    return terminal;
  };

  const getOdooServerTerminal = () => {
    return getOdooDevTerminal(ODOO_SERVER_TERMINAL);
  };

  const getOdooShellTerminal = () => {
    return getOdooDevTerminal(ODOO_SHELL_TERMINAL);
  };

  const getConfigFilePath = async () => {
    let configFilePath: string | undefined;
    let res = Result.try_(() => {
      const odooConfigPath = vscode.workspace.getConfiguration("odooDev").odooConfigPath;
      if (odooConfigPath) {
        const stat = fs.statSync(odooConfigPath as string);
        if (stat.isFile()) {
          configFilePath = odooConfigPath;
        } else {
          throw new Error(`${odooConfigPath} is not a file`);
        }
      } else {
        throw new Error("No config file path specified.");
      }
    });

    if (!Result.check(res)) {
      res = Result.try_(() => {
        const homeOdooRc = `${os.homedir()}/.odoorc`;
        const homeOdooConfStat = fs.statSync(homeOdooRc);
        if (homeOdooConfStat.isFile()) {
          configFilePath = homeOdooRc;
        } else {
          throw new Error(".odoorc is not a file.");
        }
      });
    }

    if (!Result.check(res)) {
      const res = await vscode.window.showInformationMessage(
        "No config file specified. Would you like to select one?",
        "Yes",
        "No"
      );
      if (res === "Yes") {
        const configFilePathUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: "Select Config",
        });
        if (configFilePathUri) {
          configFilePath = configFilePathUri[0].fsPath;
          vscode.workspace
            .getConfiguration("odooDev")
            .update("odooConfigPath", configFilePath, vscode.ConfigurationTarget.Global);
        } else {
          throw new Error("Unable to run command. No config file selected.");
        }
      } else {
        throw new Error("Unable to run command. No config file specified.");
      }
    }

    return configFilePath!;
  };

  const unstash = async (repo: Repository, branch: string) => {
    try {
      const head = await runShellCommand(`git rev-parse HEAD`, { cwd: repo.rootUri.fsPath });
      const shortHash = head.trim().substring(0, 7);
      const stash = await runShellCommand(
        `git stash list --pretty='%gd %s' | grep "${branch}: ${shortHash}" | head -1 | awk '{print $1}'`,
        {
          cwd: repo.rootUri.fsPath,
        }
      ).then((res) => res.trim());
      if (stash) {
        await runShellCommand(`git stash pop ${stash}`, {
          cwd: repo.rootUri.fsPath,
        });
      }
    } catch (_e) {
      // Failing to pop the stash is not a big deal, so we don't need to throw an error.
    }
  };

  const getActiveBranch = async () => {
    // NOTE: Upgrade repo is not considered at the moment because upgrade workflow is not yet implemented.
    const repos = [odevRepos.odoo, ...Object.entries(odevRepos.custom).map(([, repo]) => repo)];
    const branches: string[] = [];
    for (const repo of repos) {
      if (repo.state.HEAD?.name) {
        branches.push(repo.state.HEAD.name);
      }
    }
    if (branches.length === 0) {
      throw new Error("Unable to determine active branch.");
    }
    const uniqueBranches = [...new Set(branches)];
    if (uniqueBranches.length === 1) {
      const [branch] = uniqueBranches;
      return branch;
    } else if (uniqueBranches.length === 2) {
      const [branch1, branch2] = uniqueBranches;
      // check if one is base of the other
      const isBranch1Base = isBase(branch1);
      const isBranch2Base = isBase(branch2);
      if (isBranch1Base && getBase(branch2) === branch1) {
        return branch2;
      } else if (isBranch2Base && getBase(branch1) === branch2) {
        return branch1;
      } else if (getBase(branch1) !== getBase(branch2)) {
        throw new Error("Branches in the repositories do not match.");
      } else {
        const res = await vscode.window.showQuickPick(uniqueBranches, {
          placeHolder: "Branches in the repositories do not match. Select one as db name.",
        });
        if (res) {
          return res;
        } else {
          throw new Error("Unable to determine active branch.");
        }
      }
    } else {
      // TODO: Generalize the case of more than 1 unique branches.
      const res = await vscode.window.showQuickPick(uniqueBranches, {
        placeHolder: "Branches in the repositories do not match. Select one as db name.",
      });
      if (res) {
        return res;
      } else {
        throw new Error("Unable to determine active branch.");
      }
    }
  };

  const getNormalStartServerArgs = async () => {
    const configFilePath = await getConfigFilePath();
    const args = ["-c", configFilePath];
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      const branch = await getActiveBranch();
      if (branch) {
        args.push("-d", branch.slice(0, 63));
      }
    }
    return args;
  };

  const getOdooShellCommandArgs = async () => {
    const normalArgs = await getNormalStartServerArgs();
    // TODO: Make the port configurable.
    return ["shell", ...normalArgs, "-p", "9999"];
  };

  const getstartSelectedTestArgs = async (testTag: string) => {
    const args = await getNormalStartServerArgs();
    return [...args, "--stop-after-init", "--test-enable", "--test-tags", testTag];
  };

  const getStartCurrentTestFileArgs = async (testFilePath: string) => {
    const args = await getNormalStartServerArgs();
    return [...args, "--stop-after-init", "--test-file", testFilePath];
  };

  async function getOdooConfigValue(key: string) {
    const configFilePath = await getConfigFilePath();
    const configFileData = fs.readFileSync(configFilePath, "utf-8");
    const config = ini.parse(configFileData);
    return config?.options?.[key] as string | undefined;
  }

  async function getDBName() {
    let dbName: string | undefined;
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      dbName = await getActiveBranch();
    } else {
      dbName = await getOdooConfigValue("db_name");
    }
    return dbName?.slice(0, 63);
  }

  const isOdooServerRunning = async (terminalPID: number) => {
    const procs = await getChildProcs(terminalPID);
    const serverProcs = await Promise.all(procs.map((proc) => isOdooServer(parseInt(proc.PID))));
    return serverProcs.filter((x) => x).length > 0;
  };

  async function ensureNoActiveServer(shouldConfirm = true) {
    const terminalPID = await getOdooServerTerminal().processId;
    if (!terminalPID) {
      return Result.success();
    }
    const hasActiveServer = await isOdooServerRunning(terminalPID);
    if (hasActiveServer) {
      if (shouldConfirm) {
        const response = await vscode.window.showQuickPick(["Okay"], {
          title: "There is an active server, it will be stopped to continue.",
        });
        if (!response) {
          return Result.fail(
            new Error("There is an active server, it should be stopped before starting a new one.")
          );
        }
      }
      await killOdooServer(terminalPID);
    }
    return Result.success();
  }

  async function ensureNoDebugSession(shouldConfirm = true) {
    for (const debugSession of getDebugSessions()) {
      if (debugSession.name.includes(DEBUG_JS_NAME) && debugSession.type === "pwa-chrome") {
        // Ignore debug session if it is for debugging chrome, so return early.
        continue;
      }
      if (shouldConfirm) {
        const response = await vscode.window.showQuickPick(["Okay"], {
          title: "There is an active debug session, it will be stopped to continue.",
        });
        if (!response) {
          return Result.fail(
            new Error(
              "There is an active debug session, it should be stopped before starting a new one."
            )
          );
        }
      }
      await vscode.debug.stopDebugging(debugSession);
    }
    return Result.success();
  }

  async function ensureNoRunningServer(shouldConfirm = true) {
    const noActiveServerResult = await ensureNoActiveServer(shouldConfirm);
    if (!Result.check(noActiveServerResult)) {
      return noActiveServerResult;
    }

    const noDebugSessionResult = await ensureNoDebugSession(shouldConfirm);
    if (!Result.check(noDebugSessionResult)) {
      return noDebugSessionResult;
    }

    return Result.success();
  }

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const isRepoClean = async (repo: Repository) => {
    const status = await runShellCommand("git status --porcelain", {
      cwd: repo.rootUri.fsPath,
    });
    return status.trim().length === 0;
  };

  const getDirtyRepoNames = async () => {
    const odoo = odevRepos.odoo;
    const upgrade = odevRepos.upgrade;

    const results = await Promise.all([
      taggedCall("odoo", () => isRepoClean(odoo)),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        taggedCall(name, () => isRepoClean(repo))
      ),
      taggedCall("upgrade", async () => (upgrade ? isRepoClean(upgrade) : true)),
    ]);

    return results.filter((r) => !r.result).map((r) => r.tag);
  };

  const getDirtyRepos = async () => {
    const odoo = odevRepos.odoo;
    const upgrade = odevRepos.upgrade;

    const results = await Promise.all([
      taggedCall(odoo, () => isRepoClean(odoo)),
      ...Object.entries(odevRepos.custom).map(([, repo]) =>
        taggedCall(repo, () => isRepoClean(repo))
      ),
      ...(upgrade ? [taggedCall(upgrade, () => isRepoClean(upgrade))] : []),
    ]);

    return results.filter((r) => !r.result).map((r) => r.tag);
  };

  const isMatchingFork = (r: Remote, name: string) => {
    const nameMatched = r.name === name;
    if (nameMatched) {
      return true;
    } else if (r.fetchUrl) {
      const match = r.fetchUrl.match(FETCH_URL_REGEX);
      if (match) {
        return match[1] === name;
      } else {
        return false;
      }
    } else {
      return false;
    }
  };

  const fetchBranch = async (
    repoName: string,
    repo: Repository,
    base: string,
    branch: string,
    isDirty: boolean,
    fork?: string
  ) => {
    let remote = "origin";
    if (fork) {
      for (const r of repo.state.remotes.filter((r) => isMatchingFork(r, fork))) {
        remote = r.name;
        break;
      }
    } else {
      remote = (await findRemote(repo, branch)) || "origin";
    }
    let branchToCheckout = branch;
    const fetchRes = await Result.try_(() => repo.fetch(remote, branch));
    if (!Result.check(fetchRes)) {
      if (!base) {
        throw new Error("Unable to checkout the branch even its base.");
      }
      branchToCheckout = base;
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, {
        cwd: repo.rootUri.fsPath,
      });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }

    const checkoutRes = await Result.try_(() => repo.checkout(branchToCheckout));
    if (!Result.check(checkoutRes)) {
      if (branchToCheckout !== branch) {
        return Result.fail(
          new Error(
            `Failed to fetch '${branch}' (and checkout '${branchToCheckout}' as an alternative) in '${repoName}' because of "${checkoutRes.error.message}".`
          )
        );
      } else {
        return Result.fail(
          new Error(
            `Failed to checkout '${branch}' in '${repoName}' because of "${checkoutRes.error.message}".`
          )
        );
      }
    }
    return Result.success();
  };

  const fetchBranches = async (
    base: string,
    branch: string,
    dirtyRepos: string[],
    fork?: string
  ) => {
    const odoo = odevRepos.odoo;
    const upgrade = odevRepos.upgrade;

    const fetchProms = [
      fetchBranch("odoo", odoo, base, branch, dirtyRepos.includes("odoo"), fork),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        fetchBranch(name, repo, base, branch, dirtyRepos.includes(name), fork)
      ),
      upgrade && base === "master"
        ? fetchBranch("upgrade", upgrade, base, branch, dirtyRepos.includes("upgrade"), fork)
        : Promise.resolve(Result.success()),
    ];

    const fetchWithSpinner = withProgress({
      message: `Fetching '${branch}'...`,
      cb: () => Promise.all(fetchProms),
    });
    const fetchResults = await fetchWithSpinner();
    const [successes, errors] = Result.partition(fetchResults);
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const fetchOrCreateBranches = async (
    base: string,
    branch: string,
    dirtyRepos: string[],
    fork?: string
  ) => {
    // If fork is provided, we shortcut to fetchBranches.
    if (fork) {
      return fetchBranches(base, branch, dirtyRepos, fork);
    }

    const odoo = odevRepos.odoo;
    const upgrade = odevRepos.upgrade;

    // Check if at least one from the repos, it is available remotely.
    // If so, we call fetchBranches, otherwise we call createBranches.
    const findRemotes = withProgress({
      message: `Checking remotes for '${branch}'...`,
      cb: () =>
        Promise.all([
          findRemote(odoo, branch),
          ...Object.entries(odevRepos.custom).map(([, repo]) => findRemote(repo, branch)),
          upgrade ? findRemote(upgrade, branch) : Promise.resolve(undefined as string | undefined),
        ]),
    });
    const remoteChecks = await findRemotes();

    const isFromRemote = remoteChecks.some((r) => r);
    if (isFromRemote) {
      return fetchBranches(base, branch, dirtyRepos);
    } else {
      return createBranches(base, branch, dirtyRepos);
    }
  };

  const getRemoteName = (repo: Repository, fork: string) => {
    return repo.state.remotes.find((r) => isMatchingFork(r, fork))?.name || "origin";
  };

  const fetchStableBranch = async (
    repoName: string,
    repo: Repository,
    name: string,
    isDirty: boolean
  ) => {
    const remote = getRemoteName(repo, "odoo");
    const fetchRes = await Result.try_(() => repo.fetch(remote, name));
    if (!Result.check(fetchRes)) {
      return Result.fail(
        new Error(
          `Failed to fetch '${name}' in '${repoName}' because of "${fetchRes.error.message}".`
        )
      );
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }

    const checkoutRes = await tryRunShellCommand(`git checkout --track ${remote}/${name}`, {
      cwd: repo.rootUri.fsPath,
    });
    if (!Result.check(checkoutRes)) {
      return Result.fail(
        new Error(
          `Failed to checkout '${name}' in '${repoName}' because of "${checkoutRes.error.message}".`
        )
      );
    }
    return Result.success();
  };

  const fetchStableBranches = async (name: string, dirtyRepos: string[]) => {
    const fetchProms = [
      fetchStableBranch("odoo", odevRepos.odoo, name, dirtyRepos.includes("odoo")),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        fetchStableBranch(name, repo, name, dirtyRepos.includes(name))
      ),
    ];

    const fetchWithSpinner = withProgress({
      message: `Fetching '${name}'...`,
      cb: () => Promise.all(fetchProms),
    });
    const fetchResults = await fetchWithSpinner();

    const [successes, errors] = Result.partition(fetchResults);
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join(" "));
    }
  };

  const simpleCheckout = async (repo: Repository, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }
    let branchToUnstash: string | undefined;
    const checkoutBranchRes = await Result.try_(() => repo.checkout(branch));
    if (!Result.check(checkoutBranchRes)) {
      const base = inferBaseBranch(branch);
      if (base) {
        const checkoutBaseRes = await Result.try_(() => repo.checkout(base));
        if (!Result.check(checkoutBaseRes)) {
          return Result.fail(
            new Error(`${checkoutBranchRes.error.message} & ${checkoutBaseRes.error.message}`)
          );
        } else {
          branchToUnstash = base;
        }
      }
    } else {
      branchToUnstash = branch;
    }
    if ((vscode.workspace.getConfiguration("odooDev").autoStash as boolean) && branchToUnstash) {
      await unstash(repo, branchToUnstash);
    }
    return Result.success();
  };

  const checkoutUpgrade = async (branch: string, isDirty: boolean) => {
    const upgradeBranch = inferBaseBranch(branch) === "master" ? branch : "master";
    const repo = odevRepos.upgrade;
    if (repo) {
      if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
        const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
        if (!Result.check(stashRes)) {
          return Result.fail(
            new Error(
              `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
            )
          );
        }
      }
      let branchToUnstash: string | undefined;
      const checkoutBranchRes = await Result.try_(() => repo.checkout(upgradeBranch));
      if (!Result.check(checkoutBranchRes) && upgradeBranch !== "master") {
        const checkoutMasterRes = await Result.try_(() => repo.checkout("master"));
        if (!Result.check(checkoutMasterRes)) {
          return Result.fail(
            new Error(`${checkoutBranchRes.error.message} & ${checkoutMasterRes.error.message}`)
          );
        } else {
          branchToUnstash = "master";
        }
      } else {
        branchToUnstash = upgradeBranch;
      }
      if ((vscode.workspace.getConfiguration("odooDev").autoStash as boolean) && branchToUnstash) {
        await unstash(repo, branchToUnstash);
      }
    }
    return Result.success();
  };

  const checkoutBranches = async (branch: string, dirtyRepos: string[]) => {
    const checkoutProms = [
      simpleCheckout(odevRepos.odoo, branch, dirtyRepos.includes("odoo")),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        simpleCheckout(repo, branch, dirtyRepos.includes(name))
      ),
      checkoutUpgrade(branch, dirtyRepos.includes("upgrade")),
    ];
    const checkWithSpinner = withProgress({
      message: `Checking out '${branch}'...`,
      cb: () => Promise.all(checkoutProms),
    });
    const checkoutResults = await checkWithSpinner();
    const [successes, errors] = Result.partition(checkoutResults);
    if (successes.length === 0) {
      throw new Error("Failed to checkout the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const createBranch = async (repo: Repository, base: string, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }
    // Checkout base first as basis for creating the new branch.
    const checkoutBase = await Result.try_(() => repo.checkout(base));
    if (!Result.check(checkoutBase)) {
      return Result.fail(
        new Error(
          `Failed at checking out the base branch '${base}' because of "${checkoutBase.error.message}"`
        )
      );
    }
    if (vscode.workspace.getConfiguration("odooDev").pullBaseOnCreate as boolean) {
      try {
        await repo.pull();
      } catch (error) {
        // Creation of branch should continue even if the pull failed so we ignore the error.
      }
    }
    const createAndCheckoutBranch = await Result.try_(() => repo.createBranch(branch, true));
    if (!Result.check(createAndCheckoutBranch)) {
      return Result.fail(
        new Error(
          `Failed at creating the branch '${branch}' because of "${createAndCheckoutBranch.error.message}"`
        )
      );
    }
    return Result.success();
  };

  const createUpgradeBranch = async (
    repo: Repository,
    base: string,
    branch: string,
    isDirty: boolean
  ) => {
    if (base === "master") {
      return createBranch(repo, base, branch, isDirty);
    } else {
      if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
        const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
        if (!Result.check(stashRes)) {
          return Result.fail(
            new Error(
              `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
            )
          );
        }
      }
      return Result.try_(() => repo.checkout("master"));
    }
  };

  /**
   * - Checks out to the base.
   * - Create and checkout the branch.
   * @param base
   * @param branch
   */
  const createBranches = async (base: string, branch: string, dirtyRepos: string[]) => {
    const createBranchProms = [
      // branch in odoo
      createBranch(odevRepos.odoo, base, branch, dirtyRepos.includes("odoo")),

      // branch in custom addons repos
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        createBranch(repo, base, branch, dirtyRepos.includes(name))
      ),

      // branch in upgrade
      odevRepos.upgrade
        ? createUpgradeBranch(odevRepos.upgrade, base, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const createWithSpinner = withProgress({
      message: `Creating '${branch}'...`,
      cb: () => Promise.all(createBranchProms),
    });
    const createResults = await createWithSpinner();
    const [successes, errors] = Result.partition(createResults);
    if (successes.length === 0) {
      throw new Error("Failed to create the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const deleteBranch = async (repo: Repository, base: string, branch: string) => {
    assert(base !== branch, "Value of the base can't be the same as branch.");
    const currentBranch = repo.state.HEAD?.name;
    if (currentBranch === branch) {
      // If the branch to delete is the active branch, we need to checkout to the base branch first.
      const checkoutBaseRes = await simpleCheckout(repo, base, false);
      if (!Result.check(checkoutBaseRes)) {
        return Result.fail(
          new Error(
            `Failed to delete '${branch}' because it is the active branch and unable to checkout to the '${base}' base branch.`
          )
        );
      }
      if (vscode.workspace.getConfiguration("odooDev").autoStash as boolean) {
        await unstash(repo, base);
      }
    }
    const repoBranch = await getBranch(repo, branch);
    if (!repoBranch) {
      return Result.success();
    }
    const deleteBranchRes = await Result.try_(() => repo.deleteBranch(branch, true));
    if (!Result.check(deleteBranchRes)) {
      return Result.fail(
        new Error(`Failed to delete '${branch}' because of "${deleteBranchRes.error.message}"`)
      );
    }
    return Result.success();
  };

  const deleteBranches = async (base: string, branch: string) => {
    const upgrade = odevRepos.upgrade;

    const deleteProms = [
      deleteBranch(odevRepos.odoo, base, branch),
      ...Object.entries(odevRepos.custom).map(([, repo]) => deleteBranch(repo, base, branch)),
      upgrade && base === "master"
        ? deleteBranch(upgrade, base, branch)
        : Promise.resolve(Result.success()),
    ];

    const deleteWithSpinner = withProgress({
      message: `Deleting '${branch}'...`,
      cb: () => Promise.all(deleteProms),
    });
    const deleteResults = await deleteWithSpinner();
    const [successes, errors] = Result.partition(deleteResults);
    if (successes.length === 0) {
      throw new Error("Failed to delete the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const getBranchAndBase = (repo: Repository) => {
    const branch = repo.state.HEAD?.name;
    if (!branch) {
      return Result.fail(new Error(`Failed to rebase because no active branch found.`));
    }
    const base = getBase(branch);
    if (!base) {
      return Result.fail(
        new Error(`Failed to rebase '${branch}' because the base branch can't be recognized.`)
      );
    }
    return Result.success({ branch, base });
  };

  const rebaseBranch = async (repo: Repository, isDirty: boolean) => {
    const branchAndBaseRes = getBranchAndBase(repo);
    if (!Result.check(branchAndBaseRes)) {
      return branchAndBaseRes;
    }
    const { branch, base } = branchAndBaseRes.value;

    // stash changes
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }

    // pull --rebase
    const remoteOfBase = await getRemoteOfBase(repo, branch);
    if (!remoteOfBase) {
      return Result.fail(
        new Error(`Failed to rebase '${branch}' because no remote found for the base branch.`)
      );
    }

    const pullRes = await tryRunShellCommand(`git pull --rebase --quiet ${remoteOfBase} ${base}`, {
      cwd: repo.rootUri.fsPath,
    });

    if (!Result.check(pullRes)) {
      return Result.fail(
        new Error(
          `Failed to rebase '${branch}' because of "${pullRes.error.message}".\n\nYou probably need to resolve conflicts manually.`
        )
      );
    }

    // unstash changes
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      await unstash(repo, branch);
    }

    return Result.success();
  };

  const rebaseUpgrade = async (repo: Repository, isDirty: boolean) => {
    const branchAndBaseRes = getBranchAndBase(repo);
    if (!Result.check(branchAndBaseRes)) {
      return branchAndBaseRes;
    }
    const { branch, base } = branchAndBaseRes.value;
    if (base !== "master") {
      return Result.fail(
        new Error(`Failed to rebase '${branch}' because the base branch is not 'master'.`)
      );
    }
    return rebaseBranch(repo, isDirty);
  };

  const rebaseBranches = async (dirtyRepos: string[]) => {
    const upgrade = odevRepos.upgrade;

    const tasks = [
      rebaseBranch(odevRepos.odoo, dirtyRepos.includes("odoo")),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        rebaseBranch(repo, dirtyRepos.includes(name))
      ),
      upgrade
        ? rebaseUpgrade(upgrade, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const spinner = withProgress({
      message: `Rebasing active branches...`,
      cb: () => Promise.all(tasks),
    });
    const results = await spinner();
    const [successes, errors] = Result.partition(results);
    if (successes.length === 0) {
      throw new Error("Failed to rebase the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const resetBranch = async (repoName: string, repo: Repository, isDirty: boolean) => {
    const branch = repo.state.HEAD?.name;
    if (!branch) {
      return Result.fail(new Error(`Failed to reset the active branch of '${repoName}' repo.`));
    } else {
      const remote = repo.state.HEAD?.upstream?.remote;

      if (!remote) {
        return Result.fail(
          new Error(`Failed to reset the active branch of '${repoName}' repo. No remote found.`)
        );
      }

      try {
        if (isDirty) {
          await runShellCommand("git stash", { cwd: repo.rootUri.fsPath });
        }
        await repo.fetch({ remote, ref: branch });
        await runShellCommand(`git reset --hard ${remote}/${branch}`, { cwd: repo.rootUri.fsPath });
        if (isDirty) {
          await runShellCommand("git stash pop", { cwd: repo.rootUri.fsPath });
        }
      } catch (e) {
        return Result.fail(
          new Error(
            `Failed to reset the active branch of '${repoName}' repo. Error: ${
              (e as Error).message
            }`
          )
        );
      }
      return Result.success();
    }
  };

  const resetUpgrade = async (repo: Repository, isDirty: boolean) => {
    const branch = repo.state.HEAD?.name;
    if (!branch) {
      return Result.fail(new Error(`Failed to reset the active branch of 'upgrade' repo.`));
    } else {
      const base = getBase(branch);
      if (!base || base !== "master") {
        return Result.fail(
          new Error(`Failed to reset the active branch of 'upgrade' repo. Base is not 'master'.`)
        );
      } else {
        return resetBranch("upgrade", repo, isDirty);
      }
    }
  };

  const resetBranches = async (dirtyRepos: string[]) => {
    const promises = [
      resetBranch("odoo", odevRepos.odoo, dirtyRepos.includes("odoo")),
      ...Object.entries(odevRepos.custom).map(([name, repo]) =>
        resetBranch(name, repo, dirtyRepos.includes(name))
      ),
      odevRepos.upgrade
        ? resetUpgrade(odevRepos.upgrade, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const resetWithSpinner = withProgress({
      message: `Resetting active branches...`,
      cb: () => Promise.all(promises),
    });
    const results = await resetWithSpinner();
    const [successes, errors] = Result.partition(results);
    if (successes.length === 0) {
      throw new Error("Failed to reset the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const getClassAndMethod = async (symbols: vscode.DocumentSymbol[], position: vscode.Position) => {
    // Find the class it belongs, followed by the method.
    const classSymbol = symbols.find(
      (s) => s.kind === vscode.SymbolKind.Class && s.range.contains(position)
    );
    const methodSymbol = classSymbol
      ? classSymbol.children.find(
          (s) =>
            /^test.*/.test(s.name) &&
            s.kind === vscode.SymbolKind.Method &&
            s.range.contains(position)
        )
      : undefined;
    return { classSymbol, methodSymbol };
  };

  const getTestTag = async (editor: vscode.TextEditor) => {
    const match = editor.document.uri.path.match(/.*\/addons\/(.*)\/tests\/test_.*\.py/);
    const [, addon] = match || [undefined, undefined];
    if (!addon) {
      throw new Error("Current file is not a test file.");
    }

    const position = editor.selection.active;
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      editor.document.uri
    );

    const { classSymbol, methodSymbol } = await getClassAndMethod(symbols, position);

    return `${addon}${classSymbol ? `:${classSymbol.name}` : ""}${
      methodSymbol ? `.${methodSymbol.name}` : ""
    }`;
  };

  const treeDataProvider = new OdooDevBranches(odevRepos);
  const odooAddonsTreeProvider = new OdooAddonsTree(odevRepos, getRepoPath);

  const debounce = <A extends any[], R extends any>(cb: (...args: A) => R, delay: number) => {
    let timeout: NodeJS.Timeout;
    return (...args: A) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => cb(...args), delay);
    };
  };

  const _debouncedRefreshTrees = debounce(() => {
    treeDataProvider.refresh();
    odooAddonsTreeProvider.refresh();
  }, 1000);

  function refreshTrees<A extends any[], R extends any>(
    cb: (...args: A) => Promise<R>
  ): (...args: A) => Promise<R>;
  function refreshTrees<A extends any[], R extends any>(cb: (...args: A) => R): (...args: A) => R;
  function refreshTrees<A extends any[], R extends any>(cb: (...args: A) => Promise<R> | R) {
    return (...args: A) => {
      const result = cb(...args);
      if (result instanceof Promise) {
        return result.then((val) => {
          _debouncedRefreshTrees();
          return val;
        });
      } else {
        _debouncedRefreshTrees();
        return result;
      }
    };
  }

  const getStartServerArgs = async () => {
    const testFileRegex = /.*\/(addons|enterprise)\/(.*)\/tests\/test_.*\.py/;
    const autoTest = vscode.workspace.getConfiguration("odooDev")["autoTest"] as boolean;
    let commandArgs: string[] = [];

    const editor = vscode.window.activeTextEditor;
    if (autoTest && editor) {
      const match = editor.document.uri.path.match(testFileRegex);
      const [, , addon] = match || [undefined, undefined, undefined];
      if (addon) {
        const position = editor.selection.active;
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          editor.document.uri
        );

        const { classSymbol, methodSymbol } = await getClassAndMethod(symbols, position);

        if (!classSymbol && !methodSymbol) {
          commandArgs = await getStartCurrentTestFileArgs(editor.document.uri.path);
        } else {
          const testTag = `${addon}${classSymbol ? `:${classSymbol.name}` : ""}${
            methodSymbol ? `.${methodSymbol.name}` : ""
          }`;
          commandArgs = await getstartSelectedTestArgs(testTag);
        }
      } else {
        commandArgs = await getNormalStartServerArgs();
      }
    } else {
      commandArgs = await getNormalStartServerArgs();
    }
    return commandArgs;
  };

  const sendStartServerCommand = async (command: string, terminal: vscode.Terminal) => {
    terminal.show();
    // In some odoo config files, the addons_path is set using relative paths.
    // Important to cd to the odoo repo before running the command.
    terminal.sendText(`cd ${odevRepos.odoo.rootUri.fsPath} && ${command}`);

    // when the server stops, set the context to false
    let timeout = setTimeout(async function poll() {
      const pid = await terminal.processId;
      if (!pid) {
        vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
        odooServerStatus.command = "odooDev.startServer";
        odooServerStatus.text = "$(debug-start) Start Odoo Server";
      } else {
        const isRunning = await isOdooServerRunning(pid);
        if (isRunning) {
          vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
          odooServerStatus.command = "odooDev.stopActiveServer";
          odooServerStatus.text = "$(debug-stop) Stop Odoo Server";
          timeout = setTimeout(poll, 500);
        } else {
          vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
          odooServerStatus.command = "odooDev.startServer";
          odooServerStatus.text = "$(debug-start) Start Odoo Server";
          clearTimeout(timeout);
        }
      }
    }, 2000);
  };

  const startServerWithInstall = async (selectedAddons: string[]) => {
    const startServerArgs = await getStartServerArgs();
    const args = [
      ...startServerArgs,
      ...(selectedAddons.length === 0 ? [] : ["-i", selectedAddons.join(",")]),
    ];
    const python = await getPythonPath();
    const odooBin = `${getRepoPath(odevRepos.odoo)}/odoo-bin`;
    sendStartServerCommand(`${python} ${odooBin} ${args.join(" ")}`, getOdooServerTerminal());
  };

  let githubSession: vscode.AuthenticationSession | undefined;

  const getGithubAccessToken = async () => {
    try {
      if (!githubSession) {
        githubSession = await vscode.authentication.getSession("github", ["repo"], {
          createIfNone: true,
        });
      }
    } catch (_e) {}
    if (!githubSession) {
      throw new Error("Fetching info from private repo requires github login.");
    }
    return githubSession.accessToken;
  };

  function isDependentOn(addon: string, dependency: string): boolean {
    const addonPath = `${addonsPathMap[addon]}`;
    const requirements = getRequirements(addonPath);

    if (!requirements) {
      return false;
    }

    if (requirements.includes(dependency)) {
      return true;
    }

    for (const req of requirements) {
      if (isDependentOn(req, dependency)) {
        return true;
      }
    }

    return false;
  }

  function toQueryString(params: Record<string, string>): string {
    const parts = [];
    for (const [key, value] of Object.entries(params)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return `?${parts.join("&")}`;
  }

  const getServerUrl = async (queryParams?: Record<string, string>) => {
    const ip = await runShellCommand(
      `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
    );
    const ipTrimmed = ip.trim();
    const host = ipTrimmed === "" ? "localhost" : ipTrimmed;
    const port = (await getOdooConfigValue("http_port")) || "8069";
    return `http://${host}:${port}` + `${queryParams ? toQueryString(queryParams) : ""}`;
  };

  async function multiSelectAddons() {
    const odooPath = `${getRepoPath(odevRepos.odoo)}/addons`;
    const customAddonPaths = Object.values(odevRepos.custom).map((repo) => `${getRepoPath(repo)}`);
    const odooAddons = await getAddons(odooPath);
    const customAddons = (
      await Promise.all(customAddonPaths.map((path) => getAddons(path)))
    ).flat();
    return vscode.window.showQuickPick([...odooAddons, ...customAddons], { canPickMany: true });
  }

  function selectDevBranch() {
    const devBranches = getBaseBranches()
      .map((base) => getDevBranches(base).map((b) => b.name))
      .flat();

    return vscode.window.showQuickPick(devBranches, { title: "Choose a branch" });
  }

  async function push(force: boolean) {
    // get all repos that is not base
    const repos: Record<string, Repository> = {
      odoo: odevRepos.odoo,
      ...odevRepos.custom,
    };
    if (odevRepos.upgrade) {
      repos["upgrade"] = odevRepos.upgrade;
    }

    const repoSelection = Object.entries(repos)
      .filter(([, repo]) => !BASE_BRANCH_REGEX.test(repo.state.HEAD?.name ?? ""))
      .map(([name]) => name);

    if (repoSelection.length === 0) {
      throw new Error("No repos to push.");
    }

    const repoName =
      repoSelection.length === 1
        ? repoSelection[0]
        : await vscode.window.showQuickPick(repoSelection, {
            title: "Select repo to push",
          });

    if (!repoName) {
      return;
    }

    const repo = repos[repoName];
    // check if repo is clean
    if (repo.state.workingTreeChanges.length > 0) {
      throw new Error(`Repo '${repoName}' is not clean.`);
    }

    const branch = repo.state.HEAD?.name;
    if (!branch || !DEV_BRANCH_REGEX.test(branch)) {
      throw new Error(`Repo '${repoName}' is not on a dev branch.`);
    }

    // check if branch has a remote
    let remote = repo.state.HEAD?.upstream?.remote;
    if (!remote) {
      // if not, ask user to select a remote
      const remotes = repo.state.remotes.map((r) => r.name);
      remote = await vscode.window.showQuickPick(remotes, {
        title: `Select remote for '${repoName}'`,
      });
      if (!remote) {
        return;
      }
    }

    const push = withProgress({
      message: `Pushing ${branch} to ${repoName}/${remote}...`,
      cb: () => repo.push(remote, branch, true, force ? ForcePushMode.Force : undefined),
    });

    await push();
  }

  return {
    treeDataProvider,
    odooAddonsTreeProvider,
    getConfigFilePath,
    getOdooServerTerminal,
    getOdooShellTerminal,
    getOdooShellCommandArgs,
    getPythonPath,
    getStartServerArgs,
    sendStartServerCommand,
    startServerWithInstall,
    getDBName,
    fetchBranches: refreshTrees(fetchBranches),
    fetchStableBranches: refreshTrees(fetchStableBranches),
    createBranches: refreshTrees(createBranches),
    fetchOrCreateBranches: refreshTrees(fetchOrCreateBranches),
    checkoutBranches: refreshTrees(checkoutBranches),
    deleteBranches: refreshTrees(deleteBranches),
    rebaseBranches: refreshTrees(rebaseBranches),
    resetBranches,
    getTestTag,
    ensureNoActiveServer,
    ensureNoDebugSession,
    ensureNoRunningServer,
    getDirtyRepoNames,
    getDirtyRepos,
    odooServerStatus,
    getGithubAccessToken,
    isDependentOn,
    addonsPathMap,
    getServerUrl,
    getRepoPath,
    multiSelectAddons,
    refreshTrees,
    odevRepos,
    getActiveBranch,
    selectDevBranch,
    push,
  };
}
