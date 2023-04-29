import * as vscode from "vscode";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";

function splitWithDashFrom(str: string, start: number) {
  return [str.substring(0, str.indexOf("-", start)), str.substring(str.indexOf("-", start) + 1)];
}

function inferBaseBranch(devBranchName: string) {
  const start = devBranchName.startsWith("saas") ? 5 : 0;
  return splitWithDashFrom(devBranchName, start)[0];
}

export function activate(context: vscode.ExtensionContext) {
  const db = new OdooPluginDB(context.globalState);

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const treeDataProvider = new OdooDevBranches(rootPath, db);

  const refreshTreeOnSuccessOrShowError = async (cb: () => void | Promise<void>) => {
    try {
      await cb();
      treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage((error as Error).message);
    }
  };

  vscode.window.registerTreeDataProvider("odoo-dev-branches", treeDataProvider);

  const disposables = [
    vscode.commands.registerCommand("odoo-dev-plugin.addBaseBranch", async () => {
      const input = await vscode.window.showInputBox({
        placeHolder: "e.g. 16.0",
        prompt: "Branch from odoo repo you want to become as base?",
      });

      if (input === undefined) {
        return;
      }

      // IMPROVEMENT: Validate if the input is proper branch from the odoo repo.
      if (input === "") {
        vscode.window.showErrorMessage("Empty input is invalid.");
        return;
      }

      return refreshTreeOnSuccessOrShowError(() => {
        const [name, seqStr] = input.split(",");
        const parsedSeq = parseInt(seqStr);
        const sequence = isNaN(parsedSeq) ? undefined : parsedSeq;
        db.addBaseBranch({ name, sequence });
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.addDevBranch", async () => {
      const input = await vscode.window.showInputBox({
        placeHolder: "e.g. master-ref-barcode-parser-jcb",
        prompt: "Add new dev branch",
      });

      if (input === undefined) {
        return;
      }

      if (input === "") {
        vscode.window.showErrorMessage("Empty input is invalid.");
        return;
      }

      const base = inferBaseBranch(input);

      return refreshTreeOnSuccessOrShowError(async () => {
        let newBase = false;
        if (!db.baseBranchExists(base)) {
          const response = await vscode.window.showQuickPick(["Yes", "No"], {
            title: `'${base}' base doesn't exist, do you want to create the base branch to proceed in creation of the dev branch '${input}'?`,
          });
          if (response && response === "Yes") {
            db.addBaseBranch({ name: base });
            newBase = true;
          } else {
            return;
          }
        }
        if (!newBase && db.devBranchExists({ base, name: input })) {
          vscode.window.showErrorMessage(`'${input}' already exists!`);
          return;
        }
        db.addDevBranch({ base, name: input });
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.removeBaseBranch", async () => {
      const baseBranches = db.getBaseBranches();
      const selected = await vscode.window.showQuickPick(
        baseBranches.map((b) => b.name),
        { title: "Select the base branch to remove" }
      );

      if (selected === undefined) {
        return;
      }

      return refreshTreeOnSuccessOrShowError(() => {
        db.removeBaseBranch(selected);
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.removeDevBranch", async () => {
      const devBranches = db
        .getBaseBranches()
        .map((base) => db.getDevBranches(base.name).map((db) => ({ ...db, base: base.name })))
        .flat();

      const selected = await vscode.window.showQuickPick(
        devBranches.map((b) => ({ ...b, label: b.name })),
        { title: "Select the dev branch to remove" }
      );

      if (selected === undefined) {
        return;
      }

      return refreshTreeOnSuccessOrShowError(() => {
        db.removeDevBranch(selected);
      });
    }),
  ];

  for (const disposable of disposables) {
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
