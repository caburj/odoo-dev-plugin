import { ExtensionContext } from "vscode";

const MAX_ITEMS = 50;

export const init = (globalState: ExtensionContext["globalState"]) => {
  const alreadyAdded: Set<string> = new Set();
  const items: string[] = [];
  for (const item of globalState.get<string[]>("odooDev.startServerCommandHistory") || []) {
    if (!alreadyAdded.has(item)) {
      items.push(item);
      alreadyAdded.add(item);
    }
  }

  const push = (terminalName: string, command: string) => {
    const item = `${terminalName} :: ${command}`;
    _remove(items, item);
    items.push(item);
    if (items.length > MAX_ITEMS) {
      items.shift();
    }
  };

  const flush = () => {
    return globalState.update("odooDev.startServerCommandHistory", items);
  };

  const top = () => {
    const topItem = items[0];
    if (topItem) {
      return topItem.split(" :: ") as [terminalName: string, command: string];
    }
  };

  return {
    push,
    flush,
    top,
    getItems() {
      return items.map((item) => item.split(" :: ") as [terminalName: string, command: string]);
    },
    async clear() {
      items.splice(0, items.length);
      await flush();
    },
  };
};

const _remove = <T>(arr: T[], val: T) => {
  const index = arr.indexOf(val);
  if (index !== -1) {
    arr.splice(index, 1);
  }
};
