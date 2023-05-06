import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { callWithSpinner, ignoreError, inferBaseBranch } from "./helpers";
import { assert } from "console";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);

export type ContextualUtils = ReturnType<typeof createContextualUtils>;

type Result<T, E> = [success: true, value: T] | [success: false, error: E];

class ResultGenerator<T> {
  success(val: T) {
    return [true, val] as Result<T, string>;
  }
  error(e: string) {
    return [false, e] as Result<T, string>;
  }
  isSuccess(result: Result<T, string>): result is [success: true, value: T] {
    return result[0] === true;
  }
  isError(result: Result<T, string>): result is [success: false, error: string] {
    return result[0] === false;
  }
  async runAsync(cb: () => Promise<T>) {
    try {
      const result = await cb();
      return this.success(result);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}

const Result = new ResultGenerator<undefined>();

type SimpleResult = string | undefined;

function success(): SimpleResult {
  return;
}

function error(msg: string): SimpleResult {
  return msg;
}

async function runAsync(cb: () => Promise<any>): Promise<SimpleResult> {
  try {
    await cb();
    return success();
  } catch (e) {
    return error((e as Error).message);
  }
}

function isSuccess(res: SimpleResult): res is undefined {
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

  const fetchBranch = async (
    repoName: string,
    repo: Repository,
    branch: string
  ): Promise<Result<undefined, string>> => {
    try {
      await callWithSpinner({
        message: `Fetching '${branch}' from ${repoName}...`,
        cb: () => repo.fetch("dev", branch),
      });
      return Result.success(undefined);
    } catch (error) {
      return Result.error((error as { stderr: string }).stderr);
    }
  };

  const checkout = async (repoName: string, repo: Repository, branch: string) => {
    try {
      await callWithSpinner({
        message: `Checking out '${branch}' from ${repoName}...`,
        cb: () => repo.checkout(branch),
      });
      return Result.success(undefined);
    } catch (error) {
      return Result.error((error as { stderr: string }).stderr);
    }
  };

  /**
   * TODO: Regarding `toCheckout`. Perhaps it's better if it's based on user's config.
   * @param branch
   * @param toCheckout
   */
  const fetchBranches = async (base: string, branch: string, toCheckout: boolean = true) => {
    const errorMessages: string[] = [];

    const odoo = getOdooRepo();
    let res = await fetchBranch("odoo", odoo, branch);
    if (Result.isError(res)) {
      errorMessages.push("odoo");
      if (toCheckout) {
        await checkout("odoo", odoo, base);
      }
    } else if (toCheckout) {
      await checkout("odoo", odoo, branch);
    }

    const enterprise = getRepo("enterprise");
    if (enterprise) {
      res = await fetchBranch("enterprise", enterprise, branch);
      if (Result.isError(res)) {
        errorMessages.push("enterprise");
        if (toCheckout) {
          await checkout("enterprise", enterprise, base);
        }
      } else if (toCheckout) {
        await checkout("enterprise", enterprise, branch);
      }
    }

    if (inferBaseBranch(branch) === "master") {
      const upgrade = getRepo("upgrade");
      if (upgrade) {
        res = await fetchBranch("upgrade", upgrade, branch);
        if (Result.isError(res)) {
          errorMessages.push("upgrade");
          if (toCheckout) {
            await checkout("upgrade", upgrade, base);
          }
        } else if (toCheckout) {
          await checkout("upgrade", upgrade, branch);
        }
      }
    }

    if (errorMessages.length > 0) {
      vscode.window.showErrorMessage(
        `Failed to fetch from the following repos: ${errorMessages.join(",")}`
      );
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
    let checkoutResults: SimpleResult[] = [];
    await callWithSpinner({
      message: `Checking out '${branch}' in the repos (in parallel)...`,
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

    let createResults: SimpleResult[] = [];
    await callWithSpinner({
      message: `Creating '${branch}' in the repos (in parallel)...`,
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

    let deleteResults: SimpleResult[] = [];
    await callWithSpinner({
      message: `Deleting '${branch}' in the repos (in parallel)...`,
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
    getRemoteOdooDevUrl,
    getRemoteEnterpriseDevUrl,
    getRemoteUpgradeUrl,
    getOdooDevTerminal,
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
