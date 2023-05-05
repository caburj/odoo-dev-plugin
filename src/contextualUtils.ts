import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { callWithSpinner, ignoreError, inferBaseBranch } from "./helpers";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);

export type ContextualUtils = ReturnType<typeof createContextualUtils>;

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

  const tryFetchBeforeCreate = async (
    repoName: string,
    repo: Repository,
    base: string,
    branch: string
  ) => {
    try {
      await callWithSpinner({
        message: `Fetching branch from ${repoName}...`,
        cb: () => repo.fetch("dev", branch),
      });
      await repo.checkout(branch);
    } catch (error) {
      await callWithSpinner({
        message: "Remote branch not found, creating new branch locally...",
        cb: async () => {
          // Checkout base first as basis for creating the new branch.
          await repo.checkout(base);
          await repo.createBranch(branch, true);
        },
      });
    }
  };

  const createBranch = async (base: string, branch: string) => {
    const odoo = getOdooRepo();
    await tryFetchBeforeCreate("odoo", odoo, base, branch);

    const enterprise = getRepo("enterprise");
    if (enterprise) {
      await tryFetchBeforeCreate("enterprise", enterprise, base, branch);
    }

    const upgrade = getRepo("upgrade");
    if (upgrade && base === "master") {
      await tryFetchBeforeCreate("upgrade", upgrade, base, branch);
    }

    db.setActiveBranch(branch);
  };

  const checkoutBranch = async (name: string) => {
    const odoo = getOdooRepo();
    try {
      await callWithSpinner({
        message: `Checking out '${name}' in odoo...`,
        cb: () => odoo.checkout(name),
      });

      const enterprise = getRepo("enterprise");
      if (enterprise) {
        await callWithSpinner({
          message: `Checking out '${name}' in enterprise...`,
          cb: () => enterprise.checkout(name),
        });
      }

      await ignoreError(async () => {
        const upgrade = getRepo("upgrade");
        if (upgrade) {
          await callWithSpinner({
            message: `Checking out '${name}' in upgrade...`,
            cb: () => upgrade.checkout(name),
          });
        }
      });
    } catch (error) {
      throw new Error((error as Error & { stderr: string }).stderr);
    }
  };

  const selectBranch = async (name: string) => {
    await checkoutBranch(name);
    db.setActiveBranch(name);
  };

  const deleteDevBranch = async (name: string) => {
    const odoo = getOdooRepo();
    await ignoreError(async () => {
      await callWithSpinner({
        message: `Deleting '${name}' in odoo...`,
        cb: () => odoo.deleteBranch(name, true),
      });

      const enterprise = getRepo("enterprise");
      if (enterprise) {
        await callWithSpinner({
          message: `Deleting '${name}' in enterprise...`,
          cb: () => enterprise.deleteBranch(name, true),
        });
      }

      const base = inferBaseBranch(name);
      if (base === "master") {
        const upgrade = getRepo("upgrade");
        if (upgrade) {
          await callWithSpinner({
            message: `Deleting '${name}' in upgrade...`,
            cb: () => upgrade.deleteBranch(name, true),
          });
        }
      }
    });
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
    createBranch,
    selectBranch,
    deleteDevBranch,
    getBaseBranches,
    getTestTag,
    getTestFilePath,
    refreshTreeOnSuccess,
  };
}
