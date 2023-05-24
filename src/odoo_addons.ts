import * as vscode from "vscode";
import * as fs from "fs";
import { getAddons, isAddon, removeComments } from "./helpers";
import { requirementsRegex } from "./constants";

function getRequirements(addonPath: string): string[] | undefined {
  const manifestFilePath = `${addonPath}/__manifest__.py`;
  const manifestContent = removeComments(fs.readFileSync(manifestFilePath, "utf8"));
  const requirementsMatch = manifestContent.match(requirementsRegex);
  const requirementsStr = requirementsMatch ? requirementsMatch[1] : "";
  return eval(`${requirementsStr}`) as string[] | undefined;
}

export class OdooAddonsTree implements vscode.TreeDataProvider<OdooAddon> {
  private _onDidChangeTreeData: vscode.EventEmitter<OdooAddon | undefined | void> =
    new vscode.EventEmitter<OdooAddon | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooAddon | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private odooPath: string, private enterprisePath?: string) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OdooAddon): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OdooAddon): Promise<OdooAddon[]> {
    if (!element) {
      const odooRoot = new OdooAddon("odoo", this.odooPath, "addon-root");
      if (!this.enterprisePath) {
        return [odooRoot];
      } else {
        const enterpriseRoot = new OdooAddon("enterprise", this.enterprisePath, "addon-root");
        return [odooRoot, enterpriseRoot];
      }
    } else {
      if (element.name === "odoo") {
        const path1 = `${this.odooPath}/addons`;
        const path2 = `${this.odooPath}/odoo/addons`;
        const addons1 = (await getAddons(path1)).map((name) => [name, `${path1}/${name}`]);
        const addons2 = (await getAddons(path2)).map((name) => [name, `${path2}/${name}`]);
        const odooAddons = [...addons1, ...addons2];
        return odooAddons.map(([name, path]) => {
          return new OdooAddon(name, path, "addon");
        });
      } else if (element.name === "enterprise") {
        const path = this.enterprisePath!;
        const enterpriseAddons = (await getAddons(path)).map((name) => [name, `${path}/${name}`]);
        return enterpriseAddons.map(([name, path]) => {
          return new OdooAddon(name, path, "addon");
        });
      } else {
        const requirements = getRequirements(element.path);
        if (!requirements) {
          return [];
        } else {
          return Promise.all(
            requirements.map(async (name) => {
              const paths = [`${this.odooPath}/addons`, `${this.odooPath}/odoo/addons`];
              if (this.enterprisePath) {
                paths.push(this.enterprisePath);
              }
              const thePath = (
                await Promise.all(
                  paths.map(
                    async (path) => [path, await isAddon(`${path}/${name}`)] as [string, boolean]
                  )
                )
              )
                .filter(([, isa]) => isa)
                .map(([path]) => path)[0];
              return new OdooAddon(name, `${thePath}/${name}`, "addon");
            })
          );
        }
      }
    }
  }
}

export class OdooAddon extends vscode.TreeItem {
  public requirements: string[] | undefined;
  constructor(
    readonly name: string,
    readonly path: string,
    readonly contextValue: string,
    readonly command?: vscode.Command
  ) {
    let requirements: string[] | undefined;
    let collapsibleState: vscode.TreeItemCollapsibleState;
    if (contextValue === "addon-root") {
      collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else if (contextValue === "addon") {
      requirements = getRequirements(path);
      if (requirements) {
        collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      } else {
        collapsibleState = vscode.TreeItemCollapsibleState.None;
      }
    } else {
      collapsibleState = vscode.TreeItemCollapsibleState.None;
    }
    super(name, collapsibleState);
    this.name = name;
    this.path = path;
    this.requirements = requirements;
    this.contextValue = contextValue;
  }
}
