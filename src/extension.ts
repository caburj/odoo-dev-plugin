/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import { createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";
import { migrate } from "./odoo_plugin_db";

const ALIASES: Record<string, string[]> = {
  "odooDev.checkoutBranch": ["odooDev.selectBranch"],
  "odooDev.deleteBranch": ["odooDev.removeBranch"],
};

let stopServerStatus: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  stopServerStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  stopServerStatus.command = "odooDev.stopActiveServer";
  stopServerStatus.text = "$(debug-stop) Stop Odoo Server";

  const utils = createContextualUtils(context, { stopServerStatus });

  vscode.debug.onDidTerminateDebugSession(() => {
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
    stopServerStatus.hide();
  });

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
    const registrations = [vscode.commands.registerCommand(name, method)];
    if (name in ALIASES) {
      for (const alias of ALIASES[name]) {
        registrations.push(vscode.commands.registerCommand(alias, method));
      }
    }
    return registrations;
  });

  for (const disposable of disposables.flat()) {
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  stopServerStatus.dispose();
}
