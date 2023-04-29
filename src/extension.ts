import * as vscode from 'vscode';
import { OdooDevBranches } from './odoo_dev_branch';

export function activate(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  vscode.window.registerTreeDataProvider(
    'odoo-dev-branches',
    new OdooDevBranches(rootPath)
  );

  let disposable = vscode.commands.registerCommand(
    'odoo-dev-plugin.addBaseBranch',
    async () => {
      const input = await vscode.window.showInputBox({
        placeHolder: 'e.g. 16.0',
        prompt: 'Branch from odoo repo you want to become as base?',
      });
      // IMPROVEMENT: Validate if the input is proper branch from the odoo repo.
      const keys = context.globalState.keys();
      if (input) {
        if (!keys.includes(input)) {
          context.globalState.update(input, [input]);
        } else {
          vscode.window.showInformationMessage(
            `'${input}' is already included as base branch.`
          );
        }
      } else {
        vscode.window.showErrorMessage('Please provide an input.');
      }
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
