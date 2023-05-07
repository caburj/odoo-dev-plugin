import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as ini from "ini";
import { GitExtension, Repository } from "./git";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { callWithSpinner, inferBaseBranch } from "./helpers";
import { assert } from "console";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);

export type ContextualUtils = ReturnType<typeof createContextualUtils>;

type Result = string | undefined;

function success(): Result {
  return;
}

function error(msg: string): Result {
  return msg;
}

function run(cb: () => any): Result {
  try {
    cb();
    return success();
  } catch (e) {
    return error((e as Error).message);
  }
}

async function runAsync(cb: () => Promise<any>): Promise<Result> {
  try {
    await cb();
    return success();
  } catch (e) {
    return error((e as Error).message);
  }
}

function isSuccess(res: Result): res is undefined {
  return res === undefined;
}

export function createContextualUtils(context: vscode.ExtensionContext) {
  const db = new OdooPluginDB(context.globalState);

  let odooDevTerminal: vscode.Terminal | undefined;

  const getOdooDevTerminal = () => {
    if (!odooDevTerminal) {
      odooDevTerminal = vscode.window.createTerminal({
        name: "Odoo Dev Terminal",
        cwd: `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo`,
      });
      vscode.window.onDidCloseTerminal((t) => {
        if (t === odooDevTerminal) {
          odooDevTerminal = undefined;
        }
      });
      odooDevTerminal.show();
    }
    return odooDevTerminal;
  };

  const getConfigFilePath = () => {
    let configFilePath: string | undefined;
    let res = run(() => {
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

    if (!isSuccess(res)) {
      res = run(() => {
        const homeOdooRc = `${os.homedir()}/.odoorc`;
        const homeOdooConfStat = fs.statSync(homeOdooRc);
        if (homeOdooConfStat.isFile()) {
          configFilePath = homeOdooRc;
        } else {
          throw new Error(".odoorc is not a file.");
        }
      });
    }

    if (!isSuccess(res)) {
      throw new Error(
        `Unable to find an odoo config file. Generate a config file using '--save' option when executing 'odoo-bin' or if you already have a config file, specify it in the settings "Odoo Dev Config Path".`
      );
    }

    return configFilePath!;
  };

  const getStartServerArgs = () => {
    const configFilePath = getConfigFilePath();
    const args = ["-c", configFilePath];
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      const branch = db.getActiveBranch();
      if (branch) {
        args.push("-d", branch);
      }
    }
    return args;
  };

  const getStartServerWithInstallArgs = (selectedAddons: string[]) => {
    const args = getStartServerArgs();
    if (selectedAddons.length >= 1) {
      args.push("-i", selectedAddons.join(","));
    }
    return args;
  };

  const getStartServerWithUpdateArgs = (selectedAddons: string[]) => {
    const args = getStartServerArgs();
    if (selectedAddons.length >= 1) {
      args.push("-u", selectedAddons.join(","));
    }
    return args;
  };

  const getstartSelectedTestArgs = (testTag: string) => {
    const args = getStartServerArgs();
    return [...args, "--stop-after-init", "--test-enable", "--test-tags", testTag];
  };

  const getStartCurrentTestFileArgs = (testFilePath: string) => {
    const args = getStartServerArgs();
    return [...args, "--stop-after-init", "--test-file", testFilePath];
  };

  function getOdooConfigValue(key: string) {
    const configFilePath = getConfigFilePath();
    const configFileData = fs.readFileSync(configFilePath, "utf-8");
    const config = ini.parse(configFileData);
    return config?.options?.[key] as string | undefined;
  }

  function getActiveDBName() {
    let dbName: string | undefined;
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      dbName = db.getActiveBranch();
    } else {
      dbName = getOdooConfigValue("db_name");
    }
    return dbName;
  }

  const getRemoteOdooDevUrl = () => {
    const res = vscode.workspace.getConfiguration("odooDev").remoteOdooDevUrl as string;
    if (!res) {
      throw new Error("Please provide remote dev url for your odoo repo.");
    }
    return res;
  };

  const getRemoteEnterpriseDevUrl = () =>
    vscode.workspace.getConfiguration("odooDev").remoteEnterpriseDevUrl as string;

  const getRemoteUpgradeUrl = () =>
    vscode.workspace.getConfiguration("odooDev").remoteUpgradeUrl as string;

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const getRepo = (name: string) => {
    const sourceFolder = vscode.workspace.getConfiguration("odooDev").sourceFolder as string;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(sourceFolder), name);
    const repo = git.getRepository(uri);
    return repo;
  };

  const getOdooRepo = () => {
    const repo = getRepo("odoo");
    if (!repo) {
      throw new Error("'odoo' repo not found.");
    }
    return repo;
  };

  const fetchBranch2 = async (
    repoName: string,
    repo: Repository,
    base: string,
    branch: string,
    // TODO: Maybe this should be based on configuration.
    checkout: boolean = true
  ) => {
    let branchToCheckout = branch;
    const fetchRes = await runAsync(() => repo.fetch("dev", branch));
    if (!isSuccess(fetchRes)) {
      branchToCheckout = base;
    }
    if (checkout) {
      const checkoutRes = await runAsync(() => repo.checkout(branchToCheckout));
      if (!isSuccess(checkoutRes)) {
        if (branchToCheckout !== branch) {
          return error(
            `Failed to fetch '${branch}' (and checkout '${branchToCheckout}' as an alternative) in '${repoName}' because of "${checkoutRes}".`
          );
        } else {
          return error(
            `Failed to checkout '${branch}' in '${repoName}' because of "${checkoutRes}".`
          );
        }
      }
    }
    return success();
  };

  const fetchBranches = async (base: string, branch: string) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const fetchProms = [
      fetchBranch2("odoo", odoo, base, branch),
      enterprise
        ? fetchBranch2("enterprise", enterprise, base, branch)
        : Promise.resolve(success()),
      upgrade && base === "master"
        ? fetchBranch2("upgrade", upgrade, base, branch)
        : Promise.resolve(success()),
    ];

    let fetchResults: Result[] = [];
    await callWithSpinner({
      message: `Fetching '${branch}'...`,
      cb: async () => {
        fetchResults = await Promise.all(fetchProms);
      },
    });
    const errors = fetchResults.filter((res) => !isSuccess(res)) as string[];
    if (error.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const simpleCheckout = async (repo: Repository, branch: string) => {
    const checkoutBranchRes = await runAsync(() => repo.checkout(branch));
    if (!isSuccess(checkoutBranchRes)) {
      const base = inferBaseBranch(branch);
      if (base) {
        const checkoutBaseRes = await runAsync(() => repo.checkout(base));
        if (!isSuccess(checkoutBaseRes)) {
          return error(`${checkoutBranchRes} & ${checkoutBaseRes}`);
        }
      }
    }
    return success();
  };

  const checkoutEnterprise = async (branch: string) => {
    const enterprise = getRepo("enterprise");
    if (enterprise) {
      return simpleCheckout(enterprise, branch);
    }
    return success();
  };

  const checkoutUpgrade = async (branch: string) => {
    const upgradeBranch = inferBaseBranch(branch) === "master" ? branch : "master";
    const upgrade = getRepo("upgrade");
    if (upgrade) {
      const checkoutBranchRes = await runAsync(() => upgrade.checkout(upgradeBranch));
      if (!isSuccess(checkoutBranchRes) && upgradeBranch !== "master") {
        const checkoutMasterRes = await runAsync(() => upgrade.checkout("master"));
        if (!isSuccess(checkoutMasterRes)) {
          return error(`${checkoutBranchRes} & ${checkoutMasterRes}`);
        }
      }
    }
    return success();
  };

  const checkoutBranches = async (branch: string) => {
    const checkoutProms = [
      simpleCheckout(getOdooRepo(), branch),
      checkoutEnterprise(branch),
      checkoutUpgrade(branch),
    ];
    let checkoutResults: Result[] = [];
    await callWithSpinner({
      message: `Checking out '${branch}'...`,
      cb: async () => {
        checkoutResults = await Promise.all(checkoutProms);
      },
    });
    const errors = checkoutResults.filter((res) => !isSuccess(res)) as string[];
    if (error.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const createBranch = async (repo: Repository, base: string, branch: string) => {
    // Checkout base first as basis for creating the new branch.
    const checkoutBase = await runAsync(() => repo.checkout(base));
    if (!isSuccess(checkoutBase)) {
      return error(`Failed at checking out the base branch '${base}' because of "${checkoutBase}"`);
    }
    const createAndCheckoutBranch = await runAsync(() => repo.createBranch(branch, true));
    if (!isSuccess(createAndCheckoutBranch)) {
      return error(
        `Failed at creating the branch '${branch}' because of "${createAndCheckoutBranch}"`
      );
    }
    return success();
  };

  const createUpgradeBranch = async (repo: Repository, base: string, branch: string) => {
    if (base === "master") {
      return createBranch(repo, base, branch);
    } else {
      return runAsync(() => repo.checkout("master"));
    }
  };

  /**
   * - Checks out to the base.
   * - Create and checkout the branch.
   * @param base
   * @param branch
   */
  const createBranches = async (base: string, branch: string) => {
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const createBranchProms = [
      // branch in odoo
      createBranch(getOdooRepo(), base, branch),

      // branch in enterprise
      enterprise ? createBranch(enterprise, base, branch) : Promise.resolve(success()),

      // branch in upgrade
      upgrade ? createUpgradeBranch(upgrade, base, branch) : Promise.resolve(success()),
    ];

    let createResults: Result[] = [];
    await callWithSpinner({
      message: `Creating '${branch}'...`,
      cb: async () => {
        createResults = await Promise.all(createBranchProms);
      },
    });
    const errors = createResults.filter((res) => !isSuccess(res)) as string[];
    if (error.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const deleteBranch = async (
    repo: Repository,
    base: string,
    branch: string,
    activeBranch?: string
  ) => {
    assert(base !== branch);
    if (activeBranch === branch) {
      // If the branch to delete is the active branch, we need to checkout to the base branch first.
      const checkoutBaseRes = await simpleCheckout(repo, base);
      if (!isSuccess(checkoutBaseRes)) {
        return error(
          `Failed to delete '${branch}' because it is the active branch and unable to checkout to the '${base}' base branch.`
        );
      }
    }
    const deleteBranchRes = await runAsync(() => repo.deleteBranch(branch, true));
    if (!isSuccess(deleteBranchRes)) {
      return error(`Failed to delete '${branch}' because of "${deleteBranchRes}"`);
    }
    return success();
  };

  const deleteBranches = async (base: string, branch: string, activeBranch?: string) => {
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const deleteProms = [
      deleteBranch(getOdooRepo(), base, branch, activeBranch),
      enterprise
        ? deleteBranch(enterprise, base, branch, activeBranch)
        : Promise.resolve(success()),
      upgrade && base === "master"
        ? deleteBranch(upgrade, base, branch, activeBranch)
        : Promise.resolve(success()),
    ];

    let deleteResults: Result[] = [];
    await callWithSpinner({
      message: `Deleting '${branch}'...`,
      cb: async () => {
        deleteResults = await Promise.all(deleteProms);
      },
    });
    const errors = deleteResults.filter((res) => !isSuccess(res)) as string[];
    if (error.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const getBaseBranches = () => {
    const odooConfig = vscode.workspace.getConfiguration("odooDev");
    const baseBranches = Object.entries(odooConfig.baseBranches as Record<string, number>);
    baseBranches.sort((a, b) => a[1] - b[1]);
    return baseBranches.map((b) => b[0]);
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
    return `${addon}${classSymbol ? `:${classSymbol.name}` : ""}${
      methodSymbol ? `.${methodSymbol.name}` : ""
    }`;
  };

  const getTestFilePath = (editor: vscode.TextEditor) => {
    const isTestFile = /.*\/addons\/(.*)\/tests\/test_.*\.py/.test(editor.document.uri.path);
    if (!isTestFile) {
      throw new Error("Current file is not a test file.");
    }
    return editor.document.uri.path;
  };

  const treeDataProvider = new OdooDevBranches(rootPath, db, getBaseBranches);

  const refreshTreeOnSuccess = async (cb: () => void | Promise<void>) => {
    await cb();
    treeDataProvider.refresh();
  };

  return {
    db,
    treeDataProvider,
    getConfigFilePath,
    getRemoteOdooDevUrl,
    getRemoteEnterpriseDevUrl,
    getRemoteUpgradeUrl,
    getOdooDevTerminal,
    getStartServerArgs,
    getStartServerWithInstallArgs,
    getStartServerWithUpdateArgs,
    getstartSelectedTestArgs,
    getStartCurrentTestFileArgs,
    getOdooConfigValue,
    getActiveDBName,
    getRepo,
    getOdooRepo,
    fetchBranches,
    createBranches,
    checkoutBranches,
    deleteBranches,
    getBaseBranches,
    getTestTag,
    getTestFilePath,
    refreshTreeOnSuccess,
  };
}
