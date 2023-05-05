import * as vscode from "vscode";
import { createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";

export async function activate(context: vscode.ExtensionContext) {
  const utils = createContextualUtils(context);
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
