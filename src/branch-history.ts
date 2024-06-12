import { ExtensionContext } from "vscode";

export const init = (globalState: ExtensionContext["globalState"]) => {
  const alreadyAdded: Set<string> = new Set();
  const items: string[] = [];
  for (const item of globalState.get<string[]>("odooDev.branchHistory") || []) {
    if (!alreadyAdded.has(item)) {
      items.push(item);
      alreadyAdded.add(item);
    }
  }

  const push = (item: string) => {
    _remove(items, item);
    items.push(item);
  };

  const remove = (item: string) => {
    _remove(items, item);
  };

  const flush = () => {
    return globalState.update("odooDev.branchHistory", items);
  };

  return {
    push,
    remove,
    flush,
    items,
  };
};

const _remove = <T>(arr: T[], val: T) => {
  const index = arr.indexOf(val);
  if (index !== -1) {
    arr.splice(index, 1);
  }
};
