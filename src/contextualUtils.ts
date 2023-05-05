import * as vscode from "vscode";
import { GitExtension } from "./git";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { callWithSpinner } from "./helpers";

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

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const getOdooRepo = () => {
    const sourceFolder = vscode.workspace.getConfiguration("odooDev").sourceFolder as string;
    const odooUri = vscode.Uri.joinPath(vscode.Uri.file(sourceFolder), "odoo");
    const odooRepo = git.getRepository(odooUri);
    if (odooRepo === null) {
      throw new Error(`Unable to checkout. 'odoo' repo is not found in '${sourceFolder}'.`);
    }
    return odooRepo;
  };

  const createDevBranch = async (base: string, branch: string) => {
    const odooRepo = getOdooRepo();
    try {
      await callWithSpinner({
        message: "Fetching branch from odoo-dev...",
        cb: () => odooRepo.fetch("odoo-dev", branch),
      });
      await odooRepo.checkout(branch);
      db.setActiveBranch(branch);
    } catch (error) {
      await callWithSpinner({
        message: "Remote branch not found, creating new branch locally...",
        cb: async () => {
          // Checkout base first as basis for creating the new branch.
          await odooRepo.checkout(base);
          await odooRepo.createBranch(branch, true);
          db.setActiveBranch(branch);
        },
      });
    }
  };

  const checkoutDevBranch = async (branch: string) => {
    const odooRepo = getOdooRepo();
    if (odooRepo.state.HEAD?.name === branch) {
      throw new Error(`The current branch is already '${branch}`);
    }
    try {
      await callWithSpinner({
        message: `Checking out '${branch}' in odoo...`,
        cb: () => odooRepo.checkout(branch),
      });
    } catch (error) {
      throw new Error((error as Error & { stderr: string }).stderr);
    }
  };

  const selectBranch = async (name: string) => {
    await checkoutDevBranch(name);
    db.setActiveBranch(name);
  };

  const deleteDevBranch = async (name: string) => {
    const odooRepo = getOdooRepo();
    try {
      await callWithSpinner({
        message: `Deleting '${name}' branch in odoo...`,
        cb: async () => {
          await odooRepo.deleteBranch(name, true);
        },
      });
    } catch (error) {
      throw new Error((error as { stderr: string }).stderr);
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
    getOdooDevTerminal,
    getOdooRepo,
    createDevBranch,
    checkoutDevBranch,
    selectBranch,
    deleteDevBranch,
    getBaseBranches,
    getTestTag,
    getTestFilePath,
    treeDataProvider,
    refreshTreeOnSuccess,
  };
}
