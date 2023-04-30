import * as vscode from "vscode";
import { OdooPluginDB } from "./odoo_plugin_db";

export class OdooDevBranches implements vscode.TreeDataProvider<OdooDevBranch> {
  private _onDidChangeTreeData: vscode.EventEmitter<OdooDevBranch | undefined | void> =
    new vscode.EventEmitter<OdooDevBranch | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooDevBranch | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(
    private workspaceRoot: string | undefined,
    private db: OdooPluginDB,
    private getBaseBranches: () => string[]
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OdooDevBranch): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OdooDevBranch): Promise<OdooDevBranch[]> {
    if (!element) {
      const baseBranches = this.getBaseBranches();
      return baseBranches.map((name) => {
        const devBranches = this.db.getDevBranches(name);
        return new OdooDevBranch(
          name,
          devBranches.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );
      });
    } else {
      const branchName = element.label;
      return this.db
        .getDevBranches(branchName)
        .map(({ name }) => new OdooDevBranch(name, vscode.TreeItemCollapsibleState.None));
    }
  }
}

export class OdooDevBranch extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.tooltip = this.label;
  }

  contextValue = "odoo-dev-branch";
}
