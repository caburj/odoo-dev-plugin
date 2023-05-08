import * as vscode from "vscode";
import { createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";
import { migrate } from "./odoo_plugin_db";

export async function activate(context: vscode.ExtensionContext) {
  const utils = createContextualUtils(context);

  try {
    migrate(utils.db);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Migration of saved data to the recent version failed. You might notice some missing data. Cause of failure is: ${
        (error as Error).message
      }`
    );
  }

  vscode.window.registerTreeDataProvider("odoo-dev-branches", utils.treeDataProvider);

  const disposables = Object.values(commands).map((command) => {
    const { name, method } = command(utils);
    return vscode.commands.registerCommand(name, method);
  });

  for (const disposable of disposables) {
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
