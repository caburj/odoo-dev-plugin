import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class OdooDevBranches implements vscode.TreeDataProvider<OdooDevBranch> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    OdooDevBranch | undefined | void
  > = new vscode.EventEmitter<OdooDevBranch | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooDevBranch | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) {
    console.log(this.workspaceRoot);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OdooDevBranch): vscode.TreeItem {
    return element;
  }

  getChildren(element?: OdooDevBranch): Thenable<OdooDevBranch[]> {
    const root = ['master', '16.0'];
    if (element?.label && root.includes(element.label)) {
      return Promise.resolve([
        new OdooDevBranch(`${element.label}-1`, 0),
        new OdooDevBranch(`${element.label}-2`, 0),
      ]);
    }
    return Promise.resolve(root.map(v => new OdooDevBranch(v, 1)));
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

  contextValue = 'odoo-dev-branch';
}
